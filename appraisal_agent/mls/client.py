"""
MLS/MRED API integration for CACC Appraiser system.

Supports multiple MLS systems:
- MRED (Midwest Real Estate Data) - primary
- RESO Web API - generic standard
- Fallback DuckDuckGo search when no API key configured
"""

import os
import logging
import time
import json
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import re
from urllib.parse import urlencode, quote

try:
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
except ImportError:
    requests = None

try:
    import geopy.geocoders
    from geopy.exc import GeocoderTimedOut
except ImportError:
    geopy = None

logger = logging.getLogger(__name__)


class PropertyStatus(Enum):
    """Property listing status."""
    ACTIVE = "active"
    SOLD = "sold"
    PENDING = "pending"
    WITHDRAWN = "withdrawn"
    EXPIRED = "expired"


class PropertyType(Enum):
    """Property type classifications."""
    SFR = "SFR"  # Single Family Residential
    CONDO = "Condo"
    TOWNHOUSE = "Townhouse"
    MULTI = "Multi-Family"
    LAND = "Land"


@dataclass
class MLSProperty:
    """Represents a property from MLS data."""
    mls_number: str
    address: str
    city: str
    state: str
    zip_code: str
    price: float
    sale_date: Optional[str] = None
    list_date: Optional[str] = None
    sqft: Optional[float] = None
    lot_size: Optional[float] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[float] = None
    year_built: Optional[int] = None
    property_type: str = "SFR"
    status: str = "active"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    days_on_market: Optional[int] = None
    list_price: Optional[float] = None
    sale_price: Optional[float] = None
    price_per_sqft: Optional[float] = None
    photo_urls: List[str] = field(default_factory=list)
    remarks: Optional[str] = None
    features: Dict[str, Any] = field(default_factory=dict)
    source: str = "MLS"  # "MLS" or "web-sourced"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return asdict(self)


@dataclass
class MarketStats:
    """Market statistics for an area."""
    median_price: Optional[float] = None
    average_price: Optional[float] = None
    median_dom: Optional[int] = None
    total_active: int = 0
    total_sold: int = 0
    total_pending: int = 0
    months_supply: Optional[float] = None
    list_to_sale_ratio: Optional[float] = None
    price_trend_pct: Optional[float] = None
    period_start: Optional[str] = None
    period_end: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return asdict(self)


class RateLimiter:
    """Token bucket rate limiter."""

    def __init__(self, requests_per_second: float = 2.0):
        """
        Initialize rate limiter.

        Args:
            requests_per_second: Maximum requests per second
        """
        self.requests_per_second = requests_per_second
        self.min_interval = 1.0 / requests_per_second
        self.last_request_time = 0.0

    def wait(self):
        """Wait if necessary to respect rate limit."""
        elapsed = time.time() - self.last_request_time
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)
        self.last_request_time = time.time()


class MLSClient:
    """
    Base client for MLS API integration.

    Loads credentials from environment variables:
    - MLS_API_KEY: API key for MLS service
    - MLS_API_BASE_URL: Base URL for API endpoint
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        api_base_url: Optional[str] = None,
        requests_per_second: float = 2.0
    ):
        """
        Initialize MLS client.

        Args:
            api_key: MLS API key (or from MLS_API_KEY env var)
            api_base_url: Base URL for API (or from MLS_API_BASE_URL env var)
            requests_per_second: Rate limit (default 2 req/sec)
        """
        self.api_key = api_key or os.getenv("MLS_API_KEY")
        self.api_base_url = api_base_url or os.getenv("MLS_API_BASE_URL")
        self.rate_limiter = RateLimiter(requests_per_second)
        self._session = self._create_session() if requests else None

    def _create_session(self) -> Optional[Any]:
        """Create requests session with retry logic."""
        if not requests:
            logger.warning("requests library not available")
            return None

        session = requests.Session()
        retry_strategy = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "POST"]
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        return session

    def configure(self, api_key: str, api_base_url: Optional[str] = None) -> None:
        """
        Update API credentials.

        Args:
            api_key: API key for MLS service
            api_base_url: Optional base URL for API
        """
        self.api_key = api_key
        if api_base_url:
            self.api_base_url = api_base_url
        logger.info("MLS client configured")

    def is_configured(self) -> bool:
        """Check if API credentials are configured."""
        return bool(self.api_key and self.api_base_url)

    def _make_request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        timeout: int = 30
    ) -> Optional[Dict[str, Any]]:
        """
        Make HTTP request to MLS API with rate limiting and retry logic.

        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint path
            params: Query parameters
            data: Request body data
            timeout: Request timeout in seconds

        Returns:
            Response JSON or None on error
        """
        if not self._session:
            logger.error("requests library not available")
            return None

        self.rate_limiter.wait()

        url = f"{self.api_base_url}/{endpoint.lstrip('/')}"
        headers = self._get_headers()

        try:
            if method.upper() == "GET":
                response = self._session.get(
                    url, params=params, headers=headers, timeout=timeout
                )
            elif method.upper() == "POST":
                response = self._session.post(
                    url, json=data, params=params, headers=headers, timeout=timeout
                )
            else:
                logger.error(f"Unsupported HTTP method: {method}")
                return None

            response.raise_for_status()
            return response.json()

        except requests.exceptions.RequestException as e:
            logger.error(f"API request failed: {e}")
            return None

    def _get_headers(self) -> Dict[str, str]:
        """Get HTTP headers for API requests."""
        headers = {
            "User-Agent": "CACC-Appraiser/1.0",
            "Accept": "application/json"
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def geocode_address(self, address: str) -> Optional[tuple[float, float]]:
        """
        Convert address to latitude and longitude.

        Args:
            address: Full address string

        Returns:
            Tuple of (latitude, longitude) or None
        """
        if not geopy:
            logger.warning("geopy not available for geocoding")
            return None

        try:
            geocoder = geopy.geocoders.Nominatim(user_agent="cacc-appraiser")
            location = geocoder.geocode(address, timeout=10)
            if location:
                return (location.latitude, location.longitude)
        except (GeocoderTimedOut, Exception) as e:
            logger.warning(f"Geocoding failed for '{address}': {e}")

        return None

    def search_comps(
        self,
        address: str,
        radius_miles: float = 1.0,
        max_results: int = 10,
        property_type: str = "SFR",
        min_beds: Optional[int] = None,
        max_beds: Optional[int] = None,
        min_sqft: Optional[float] = None,
        max_sqft: Optional[float] = None,
        months_back: int = 12
    ) -> List[MLSProperty]:
        """
        Search for comparable sales.

        Args:
            address: Subject property address
            radius_miles: Search radius in miles
            max_results: Maximum results to return
            property_type: Property type filter (SFR, Condo, etc.)
            min_beds: Minimum bedrooms
            max_beds: Maximum bedrooms
            min_sqft: Minimum square footage
            max_sqft: Maximum square footage
            months_back: How many months back to search (default 12)

        Returns:
            List of MLSProperty objects
        """
        logger.info(f"Searching comps for: {address}")

        if not self.is_configured():
            logger.warning("MLS not configured, using fallback search")
            return self._fallback_search_comps(address, radius_miles, max_results)

        return self._mls_search_comps(
            address, radius_miles, max_results, property_type,
            min_beds, max_beds, min_sqft, max_sqft, months_back
        )

    def _mls_search_comps(
        self,
        address: str,
        radius_miles: float,
        max_results: int,
        property_type: str,
        min_beds: Optional[int],
        max_beds: Optional[int],
        min_sqft: Optional[float],
        max_sqft: Optional[float],
        months_back: int
    ) -> List[MLSProperty]:
        """Perform MLS search (override in subclasses)."""
        logger.error("_mls_search_comps not implemented in base class")
        return []

    def _fallback_search_comps(
        self,
        address: str,
        radius_miles: float,
        max_results: int
    ) -> List[MLSProperty]:
        """Fallback to web search when MLS not configured."""
        fallback_client = FallbackSearchClient()
        return fallback_client.search_comps(address, radius_miles, max_results)

    def get_property_details(self, mls_number: str) -> Optional[MLSProperty]:
        """
        Get full property details by MLS number.

        Args:
            mls_number: MLS listing number

        Returns:
            MLSProperty object or None
        """
        if not self.is_configured():
            logger.warning("MLS not configured, cannot get property details")
            return None

        return self._mls_get_property_details(mls_number)

    def _mls_get_property_details(self, mls_number: str) -> Optional[MLSProperty]:
        """Get property details from MLS (override in subclasses)."""
        logger.error("_mls_get_property_details not implemented in base class")
        return None

    def get_market_stats(
        self,
        zip_code: Optional[str] = None,
        city: Optional[str] = None,
        property_type: str = "SFR"
    ) -> Optional[MarketStats]:
        """
        Get market statistics for an area.

        Args:
            zip_code: ZIP code for search
            city: City name for search
            property_type: Property type filter

        Returns:
            MarketStats object or None
        """
        if not self.is_configured():
            logger.warning("MLS not configured, cannot get market stats")
            return None

        return self._mls_get_market_stats(zip_code, city, property_type)

    def _mls_get_market_stats(
        self,
        zip_code: Optional[str],
        city: Optional[str],
        property_type: str
    ) -> Optional[MarketStats]:
        """Get market stats from MLS (override in subclasses)."""
        logger.error("_mls_get_market_stats not implemented in base class")
        return None

    def get_active_listings(
        self,
        address: Optional[str] = None,
        zip_code: Optional[str] = None,
        radius_miles: float = 1.0
    ) -> List[MLSProperty]:
        """
        Get active listings for support.

        Args:
            address: Search by address
            zip_code: Search by ZIP code
            radius_miles: Search radius in miles

        Returns:
            List of MLSProperty objects with status=active
        """
        if not self.is_configured():
            logger.warning("MLS not configured, cannot get active listings")
            return []

        return self._mls_get_active_listings(address, zip_code, radius_miles)

    def _mls_get_active_listings(
        self,
        address: Optional[str],
        zip_code: Optional[str],
        radius_miles: float
    ) -> List[MLSProperty]:
        """Get active listings from MLS (override in subclasses)."""
        logger.error("_mls_get_active_listings not implemented in base class")
        return []

    def get_pending_sales(
        self,
        address: Optional[str] = None,
        zip_code: Optional[str] = None,
        radius_miles: float = 1.0
    ) -> List[MLSProperty]:
        """
        Get pending sales.

        Args:
            address: Search by address
            zip_code: Search by ZIP code
            radius_miles: Search radius in miles

        Returns:
            List of MLSProperty objects with status=pending
        """
        if not self.is_configured():
            logger.warning("MLS not configured, cannot get pending sales")
            return []

        return self._mls_get_pending_sales(address, zip_code, radius_miles)

    def _mls_get_pending_sales(
        self,
        address: Optional[str],
        zip_code: Optional[str],
        radius_miles: float
    ) -> List[MLSProperty]:
        """Get pending sales from MLS (override in subclasses)."""
        logger.error("_mls_get_pending_sales not implemented in base class")
        return []


class MREDClient(MLSClient):
    """
    MRED (Midwest Real Estate Data) API client.

    Implements MRED-specific API calls for MLS data access.
    Requires MLS_API_KEY and MLS_API_BASE_URL environment variables.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        api_base_url: Optional[str] = None,
        requests_per_second: float = 2.0
    ):
        """Initialize MRED client."""
        if not api_base_url:
            api_base_url = os.getenv(
                "MLS_API_BASE_URL",
                "https://api.mredllc.com/v1"
            )
        super().__init__(api_key, api_base_url, requests_per_second)

    def _mls_search_comps(
        self,
        address: str,
        radius_miles: float,
        max_results: int,
        property_type: str,
        min_beds: Optional[int],
        max_beds: Optional[int],
        min_sqft: Optional[float],
        max_sqft: Optional[float],
        months_back: int
    ) -> List[MLSProperty]:
        """Search for comps using MRED API."""
        # Geocode subject property
        coords = self.geocode_address(address)
        if not coords:
            logger.warning(f"Could not geocode address: {address}")
            return []

        lat, lng = coords

        # Build search parameters for MRED API
        params = {
            "latitude": lat,
            "longitude": lng,
            "radius_miles": radius_miles,
            "property_type": property_type,
            "status": "Sold",
            "limit": max_results,
            "sort": "sale_date_desc"
        }

        # Add date filter
        start_date = (datetime.now() - timedelta(days=months_back * 30)).strftime("%Y-%m-%d")
        params["sale_date_start"] = start_date

        # Add optional filters
        if min_beds is not None:
            params["beds_min"] = min_beds
        if max_beds is not None:
            params["beds_max"] = max_beds
        if min_sqft is not None:
            params["sqft_min"] = min_sqft
        if max_sqft is not None:
            params["sqft_max"] = max_sqft

        response = self._make_request("GET", "/listings/search", params=params)
        if not response or "listings" not in response:
            logger.warning("MRED search returned no results")
            return []

        properties = []
        for listing in response.get("listings", [])[:max_results]:
            prop = self._parse_mred_listing(listing)
            if prop:
                properties.append(prop)

        return properties

    def _parse_mred_listing(self, listing: Dict[str, Any]) -> Optional[MLSProperty]:
        """Parse MRED listing JSON to MLSProperty."""
        try:
            sale_date = listing.get("sale_date") or listing.get("closed_date")

            return MLSProperty(
                mls_number=listing.get("mls_number", ""),
                address=listing.get("address", ""),
                city=listing.get("city", ""),
                state=listing.get("state", ""),
                zip_code=listing.get("zip_code", ""),
                price=float(listing.get("sale_price", 0) or listing.get("price", 0)),
                sale_date=sale_date,
                list_date=listing.get("list_date"),
                sqft=float(listing.get("sqft", 0)) if listing.get("sqft") else None,
                lot_size=float(listing.get("lot_size", 0)) if listing.get("lot_size") else None,
                bedrooms=int(listing.get("bedrooms", 0)) if listing.get("bedrooms") else None,
                bathrooms=float(listing.get("bathrooms", 0)) if listing.get("bathrooms") else None,
                year_built=int(listing.get("year_built", 0)) if listing.get("year_built") else None,
                property_type=listing.get("property_type", "SFR"),
                status=listing.get("status", "sold").lower(),
                latitude=float(listing.get("latitude", 0)) if listing.get("latitude") else None,
                longitude=float(listing.get("longitude", 0)) if listing.get("longitude") else None,
                days_on_market=int(listing.get("days_on_market", 0)) if listing.get("days_on_market") else None,
                list_price=float(listing.get("list_price", 0)) if listing.get("list_price") else None,
                sale_price=float(listing.get("sale_price", 0)) if listing.get("sale_price") else None,
                price_per_sqft=float(listing.get("price_per_sqft", 0)) if listing.get("price_per_sqft") else None,
                photo_urls=listing.get("photo_urls", []),
                remarks=listing.get("remarks") or listing.get("description"),
                features=listing.get("features", {}),
                source="MLS"
            )
        except (KeyError, ValueError, TypeError) as e:
            logger.error(f"Error parsing MRED listing: {e}")
            return None

    def _mls_get_property_details(self, mls_number: str) -> Optional[MLSProperty]:
        """Get MRED property details."""
        response = self._make_request("GET", f"/listings/{mls_number}")
        if not response:
            return None

        return self._parse_mred_listing(response)

    def _mls_get_market_stats(
        self,
        zip_code: Optional[str],
        city: Optional[str],
        property_type: str
    ) -> Optional[MarketStats]:
        """Get MRED market statistics."""
        params = {"property_type": property_type}

        if zip_code:
            params["zip_code"] = zip_code
        elif city:
            params["city"] = city
        else:
            logger.error("Must provide zip_code or city for market stats")
            return None

        response = self._make_request("GET", "/market/stats", params=params)
        if not response:
            return None

        return MarketStats(
            median_price=float(response.get("median_price", 0)) if response.get("median_price") else None,
            average_price=float(response.get("average_price", 0)) if response.get("average_price") else None,
            median_dom=int(response.get("median_dom", 0)) if response.get("median_dom") else None,
            total_active=int(response.get("total_active", 0)),
            total_sold=int(response.get("total_sold", 0)),
            total_pending=int(response.get("total_pending", 0)),
            months_supply=float(response.get("months_supply", 0)) if response.get("months_supply") else None,
            list_to_sale_ratio=float(response.get("list_to_sale_ratio", 0)) if response.get("list_to_sale_ratio") else None,
            price_trend_pct=float(response.get("price_trend_pct", 0)) if response.get("price_trend_pct") else None,
            period_start=response.get("period_start"),
            period_end=response.get("period_end")
        )

    def _mls_get_active_listings(
        self,
        address: Optional[str],
        zip_code: Optional[str],
        radius_miles: float
    ) -> List[MLSProperty]:
        """Get MRED active listings."""
        params = {"status": "Active", "limit": 50}

        if address:
            coords = self.geocode_address(address)
            if coords:
                params["latitude"] = coords[0]
                params["longitude"] = coords[1]
                params["radius_miles"] = radius_miles
        elif zip_code:
            params["zip_code"] = zip_code
        else:
            logger.error("Must provide address or zip_code")
            return []

        response = self._make_request("GET", "/listings/search", params=params)
        if not response:
            return []

        properties = []
        for listing in response.get("listings", []):
            prop = self._parse_mred_listing(listing)
            if prop:
                properties.append(prop)

        return properties

    def _mls_get_pending_sales(
        self,
        address: Optional[str],
        zip_code: Optional[str],
        radius_miles: float
    ) -> List[MLSProperty]:
        """Get MRED pending sales."""
        params = {"status": "Pending", "limit": 50}

        if address:
            coords = self.geocode_address(address)
            if coords:
                params["latitude"] = coords[0]
                params["longitude"] = coords[1]
                params["radius_miles"] = radius_miles
        elif zip_code:
            params["zip_code"] = zip_code
        else:
            logger.error("Must provide address or zip_code")
            return []

        response = self._make_request("GET", "/listings/search", params=params)
        if not response:
            return []

        properties = []
        for listing in response.get("listings", []):
            prop = self._parse_mred_listing(listing)
            if prop:
                properties.append(prop)

        return properties


class GenericRESOClient(MLSClient):
    """
    Generic RESO Web API client.

    Implements standard RESO Web API (OData) for compatible MLS systems.
    Requires MLS_API_KEY and MLS_API_BASE_URL environment variables.
    """

    def _mls_search_comps(
        self,
        address: str,
        radius_miles: float,
        max_results: int,
        property_type: str,
        min_beds: Optional[int],
        max_beds: Optional[int],
        min_sqft: Optional[float],
        max_sqft: Optional[float],
        months_back: int
    ) -> List[MLSProperty]:
        """Search for comps using RESO Web API."""
        coords = self.geocode_address(address)
        if not coords:
            logger.warning(f"Could not geocode address: {address}")
            return []

        lat, lng = coords

        # Build OData filter
        filters = [
            f"PropertyType eq '{property_type}'",
            f"StandardStatus eq 'Closed'"
        ]

        if min_beds is not None:
            filters.append(f"BedroomsTotal ge {min_beds}")
        if max_beds is not None:
            filters.append(f"BedroomsTotal le {max_beds}")
        if min_sqft is not None:
            filters.append(f"LivingArea ge {min_sqft}")
        if max_sqft is not None:
            filters.append(f"LivingArea le {max_sqft}")

        start_date = (datetime.now() - timedelta(days=months_back * 30)).strftime("%Y-%m-%d")
        filters.append(f"CloseDate ge {start_date}")

        filter_str = " and ".join(filters)

        params = {
            "$filter": filter_str,
            "$orderby": "CloseDate desc",
            "$top": max_results
        }

        response = self._make_request("GET", "/Property", params=params)
        if not response or "value" not in response:
            logger.warning("RESO search returned no results")
            return []

        properties = []
        for listing in response.get("value", [])[:max_results]:
            prop = self._parse_reso_listing(listing)
            if prop:
                properties.append(prop)

        return properties

    def _parse_reso_listing(self, listing: Dict[str, Any]) -> Optional[MLSProperty]:
        """Parse RESO listing JSON to MLSProperty."""
        try:
            return MLSProperty(
                mls_number=listing.get("ListingKey", ""),
                address=listing.get("StreetAddress", ""),
                city=listing.get("City", ""),
                state=listing.get("StateOrProvince", ""),
                zip_code=listing.get("PostalCode", ""),
                price=float(listing.get("ClosePrice", 0) or listing.get("ListPrice", 0)),
                sale_date=listing.get("CloseDate"),
                list_date=listing.get("ListDate"),
                sqft=float(listing.get("LivingArea", 0)) if listing.get("LivingArea") else None,
                lot_size=float(listing.get("LotSizeAcres", 0)) if listing.get("LotSizeAcres") else None,
                bedrooms=int(listing.get("BedroomsTotal", 0)) if listing.get("BedroomsTotal") else None,
                bathrooms=float(listing.get("BathroomsTotalInteger", 0)) if listing.get("BathroomsTotalInteger") else None,
                year_built=int(listing.get("YearBuilt", 0)) if listing.get("YearBuilt") else None,
                property_type=listing.get("PropertyType", "SFR"),
                status=listing.get("StandardStatus", "closed").lower(),
                latitude=float(listing.get("Latitude", 0)) if listing.get("Latitude") else None,
                longitude=float(listing.get("Longitude", 0)) if listing.get("Longitude") else None,
                list_price=float(listing.get("ListPrice", 0)) if listing.get("ListPrice") else None,
                sale_price=float(listing.get("ClosePrice", 0)) if listing.get("ClosePrice") else None,
                remarks=listing.get("PublicRemarks"),
                features={},
                source="MLS"
            )
        except (KeyError, ValueError, TypeError) as e:
            logger.error(f"Error parsing RESO listing: {e}")
            return None

    def _mls_get_property_details(self, mls_number: str) -> Optional[MLSProperty]:
        """Get RESO property details."""
        params = {"$filter": f"ListingKey eq '{mls_number}'"}
        response = self._make_request("GET", "/Property", params=params)

        if not response or "value" not in response or not response["value"]:
            return None

        return self._parse_reso_listing(response["value"][0])

    def _mls_get_market_stats(
        self,
        zip_code: Optional[str],
        city: Optional[str],
        property_type: str
    ) -> Optional[MarketStats]:
        """Get RESO market statistics."""
        filters = [f"PropertyType eq '{property_type}'"]

        if zip_code:
            filters.append(f"PostalCode eq '{zip_code}'")
        elif city:
            filters.append(f"City eq '{city}'")
        else:
            logger.error("Must provide zip_code or city")
            return None

        filter_str = " and ".join(filters)
        params = {
            "$filter": filter_str,
            "$apply": "aggregate(ClosePrice with average as avg_price, "
                     "ClosePrice with min as min_price, DaysOnMarket with average as avg_dom)"
        }

        response = self._make_request("GET", "/Property", params=params)
        if not response:
            return None

        # Parse aggregation results (format varies by API implementation)
        return MarketStats(
            average_price=response.get("avg_price"),
            median_dom=response.get("avg_dom")
        )

    def _mls_get_active_listings(
        self,
        address: Optional[str],
        zip_code: Optional[str],
        radius_miles: float
    ) -> List[MLSProperty]:
        """Get RESO active listings."""
        filters = ["StandardStatus eq 'Active'"]

        if zip_code:
            filters.append(f"PostalCode eq '{zip_code}'")
        elif address:
            # Ideally would use geocoding + spatial filter
            # For now, just search by approximate city extraction
            city = address.split(",")[-2].strip() if "," in address else ""
            if city:
                filters.append(f"City eq '{city}'")

        filter_str = " and ".join(filters)
        params = {
            "$filter": filter_str,
            "$top": 50
        }

        response = self._make_request("GET", "/Property", params=params)
        if not response:
            return []

        properties = []
        for listing in response.get("value", []):
            prop = self._parse_reso_listing(listing)
            if prop:
                properties.append(prop)

        return properties

    def _mls_get_pending_sales(
        self,
        address: Optional[str],
        zip_code: Optional[str],
        radius_miles: float
    ) -> List[MLSProperty]:
        """Get RESO pending sales."""
        filters = ["StandardStatus eq 'Pending'"]

        if zip_code:
            filters.append(f"PostalCode eq '{zip_code}'")
        elif address:
            city = address.split(",")[-2].strip() if "," in address else ""
            if city:
                filters.append(f"City eq '{city}'")

        filter_str = " and ".join(filters)
        params = {
            "$filter": filter_str,
            "$top": 50
        }

        response = self._make_request("GET", "/Property", params=params)
        if not response:
            return []

        properties = []
        for listing in response.get("value", []):
            prop = self._parse_reso_listing(listing)
            if prop:
                properties.append(prop)

        return properties


class FallbackSearchClient:
    """
    Fallback web search client using DuckDuckGo.

    Used when MLS API is not configured. Provides approximate
    property data for basic appraisal research.
    """

    def __init__(self):
        """Initialize fallback client."""
        self.rate_limiter = RateLimiter(requests_per_second=1.0)

    def search_comps(
        self,
        address: str,
        radius_miles: float = 1.0,
        max_results: int = 10
    ) -> List[MLSProperty]:
        """
        Search for recent sales data using web search.

        Args:
            address: Subject property address
            radius_miles: Search radius (used to define search area)
            max_results: Maximum results to return

        Returns:
            List of MLSProperty objects marked as web-sourced
        """
        logger.info(f"Using fallback web search for: {address}")

        # Parse address for search query
        city = self._extract_city(address)

        # Search queries
        queries = [
            f"recent home sales {address}",
            f"sold homes {city}",
            f"recent property sales {city} comparables"
        ]

        properties = []
        for query in queries:
            results = self._web_search(query, max_results)
            properties.extend(results)
            if len(properties) >= max_results:
                break

        # Deduplicate and return top results
        unique_props = {p.mls_number: p for p in properties}
        return list(unique_props.values())[:max_results]

    def _extract_city(self, address: str) -> str:
        """Extract city from address string."""
        parts = address.split(",")
        if len(parts) >= 2:
            return parts[-2].strip()
        return address

    def _web_search(self, query: str, max_results: int = 5) -> List[MLSProperty]:
        """
        Perform DuckDuckGo web search and parse results.

        Args:
            query: Search query
            max_results: Maximum results to parse

        Returns:
            List of MLSProperty objects from search results
        """
        if not requests:
            logger.warning("requests library not available for web search")
            return []

        self.rate_limiter.wait()

        try:
            # DuckDuckGo search via HTTP (no API key needed)
            search_url = "https://duckduckgo.com/html"
            params = {"q": query}

            response = requests.get(
                search_url,
                params=params,
                timeout=10,
                headers={"User-Agent": "CACC-Appraiser/1.0"}
            )
            response.raise_for_status()

            # Very basic parsing of search results
            # In production, would use more robust HTML parsing
            properties = self._parse_search_results(response.text, query)
            return properties

        except requests.exceptions.RequestException as e:
            logger.warning(f"Web search failed: {e}")
            return []

    def _parse_search_results(self, html: str, query: str) -> List[MLSProperty]:
        """
        Parse HTML search results and extract property data.

        This is a basic implementation. Real implementation would
        parse Zillow, Redfin, or other real estate sites.

        Args:
            html: HTML response from search
            query: Original search query

        Returns:
            List of MLSProperty objects
        """
        properties = []

        # Simple pattern matching for prices
        price_pattern = r"\$[\d,]+"
        prices = re.findall(price_pattern, html)

        # Create synthetic properties from search results
        # Each represents a potential comparable
        for i, price_str in enumerate(prices[:5]):
            try:
                price = float(price_str.replace("$", "").replace(",", ""))

                # Create synthetic MLS property marked as web-sourced
                prop = MLSProperty(
                    mls_number=f"WEB-{i}",
                    address=query,
                    city=self._extract_city(query),
                    state="",
                    zip_code="",
                    price=price,
                    property_type="SFR",
                    status="sold",
                    source="web-sourced",
                    remarks=f"Found via web search - estimated from {query}"
                )
                properties.append(prop)

            except (ValueError, AttributeError):
                continue

        logger.info(f"Web search found {len(properties)} potential comparables")
        return properties


# Convenience function to create appropriate client
def create_mls_client(
    client_type: str = "auto",
    api_key: Optional[str] = None,
    api_base_url: Optional[str] = None
) -> MLSClient:
    """
    Factory function to create appropriate MLS client.

    Args:
        client_type: "mred", "reso", or "auto" (default)
        api_key: Optional API key override
        api_base_url: Optional API base URL override

    Returns:
        Configured MLSClient instance
    """
    if client_type == "mred":
        return MREDClient(api_key, api_base_url)
    elif client_type == "reso":
        return GenericRESOClient(api_key, api_base_url)
    else:
        # Auto-detect or default to MRED
        return MREDClient(api_key, api_base_url)
