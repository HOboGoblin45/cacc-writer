#!/usr/bin/env python3
"""
Build V4 Training Data - Clean, Deduplicated, Balanced
Fixes: inconsistent system prompts, duplicates, val leakage, category imbalance
"""
import json
import random
import hashlib
import os
from collections import Counter, defaultdict
from pathlib import Path

random.seed(42)

BASE_DIR = Path(__file__).resolve().parent.parent.parent
TRAINING_DIR = BASE_DIR / "training_output"

# Canonical system prompt - one identity for all tasks
CANONICAL_SYSTEM_PROMPT = (
    "You are Charles Cresci, an expert residential, commercial, and agricultural "
    "real estate appraiser for Cresci Appraisal & Consulting Company (CACC) in "
    "central Illinois. You write USPAP-compliant appraisal reports in a professional, "
    "concise, data-driven style. You reference specific comparables by number, include "
    "market conditions context, and every sentence adds value."
)

# Illinois cities/towns for synthetic variation
IL_CITIES = [
    ("Bloomington", "IL", "McLean"),
    ("Normal", "IL", "McLean"),
    ("Peoria", "IL", "Peoria"),
    ("Champaign", "IL", "Champaign"),
    ("Springfield", "IL", "Sangamon"),
    ("Decatur", "IL", "Macon"),
    ("Urbana", "IL", "Champaign"),
    ("Morton", "IL", "Tazewell"),
    ("East Peoria", "IL", "Tazewell"),
    ("Lincoln", "IL", "Logan"),
    ("Pontiac", "IL", "Livingston"),
    ("El Paso", "IL", "Woodford"),
    ("Eureka", "IL", "Woodford"),
    ("Lexington", "IL", "McLean"),
    ("Heyworth", "IL", "McLean"),
    ("LeRoy", "IL", "McLean"),
    ("Chenoa", "IL", "McLean"),
    ("Gridley", "IL", "McLean"),
    ("Fairbury", "IL", "Livingston"),
    ("Clinton", "IL", "DeWitt"),
]

STREET_NAMES = [
    "Oak", "Maple", "Pine", "Cedar", "Elm", "Main", "College", "Vernon",
    "Washington", "Lincoln", "Jefferson", "Madison", "Monroe", "Adams",
    "Franklin", "Hamilton", "Jackson", "Harrison", "Tyler", "Polk",
    "Taylor", "Grant", "Hayes", "Garfield", "Cleveland", "McKinley",
    "Roosevelt", "Wilson", "Coolidge", "Hoover", "Truman", "Kennedy",
]

STREET_TYPES = ["St", "Ave", "Dr", "Ln", "Ct", "Pl", "Rd", "Blvd", "Way", "Cir"]

def random_address():
    num = random.randint(100, 9999)
    street = random.choice(STREET_NAMES)
    stype = random.choice(STREET_TYPES)
    city, state, county = random.choice(IL_CITIES)
    return f"{num} {street} {stype}", city, state, county

def random_value(base_min=80000, base_max=450000):
    return round(random.randint(base_min, base_max) / 1000) * 1000

def random_sqft(min_sf=800, max_sf=4000):
    return random.randint(min_sf, max_sf)

def random_year():
    return random.randint(1920, 2024)

def random_beds():
    return random.choice([2, 3, 3, 3, 4, 4, 5])

def random_baths():
    return random.choice([1.0, 1.5, 2.0, 2.0, 2.5, 3.0])

def load_jsonl(path):
    examples = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    examples.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return examples

def save_jsonl(examples, path):
    with open(path, 'w') as f:
        for ex in examples:
            f.write(json.dumps(ex) + '\n')

def get_user_content(ex):
    msgs = ex.get('messages', [])
    for m in msgs:
        if m.get('role') == 'user':
            return m.get('content', '')
    return ''

def get_assistant_content(ex):
    msgs = ex.get('messages', [])
    for m in msgs:
        if m.get('role') == 'assistant':
            return m.get('content', '')
    return ''

def unify_system_prompt(ex):
    """Replace system prompt with canonical version"""
    msgs = ex.get('messages', [])
    if msgs and msgs[0].get('role') == 'system':
        msgs[0]['content'] = CANONICAL_SYSTEM_PROMPT
    return ex

def content_hash(ex):
    user = get_user_content(ex)
    return hashlib.md5(user.encode()).hexdigest()

def deduplicate(examples):
    """Keep longest assistant response for each unique user question"""
    by_question = defaultdict(list)
    for ex in examples:
        h = content_hash(ex)
        by_question[h].append(ex)
    
    deduped = []
    for h, group in by_question.items():
        # Keep the one with longest assistant response
        best = max(group, key=lambda x: len(get_assistant_content(x)))
        deduped.append(best)
    
    return deduped

# ---- Synthetic example generators for underrepresented categories ----

def gen_condo_appraisal():
    addr, city, state, county = random_address()
    value = random_value(120000, 350000)
    sqft = random_sqft(700, 2200)
    year = random.randint(1970, 2023)
    unit = random.randint(1, 400)
    floors = random.choice([2, 3, 4, 6, 8, 12])
    hoa = random.randint(150, 500)
    
    return {
        "type": "condo_appraisal",
        "source": "synthetic_v4",
        "messages": [
            {"role": "system", "content": CANONICAL_SYSTEM_PROMPT},
            {"role": "user", "content": f"Write the complete narrative sections for a FNM1073 condo appraisal of Unit {unit}, {addr}, {city}, {state}. The subject is a {sqft} SF {random.choice([1,2,3])}-bedroom condo in a {floors}-story building built in {year}. HOA is ${hoa}/month. Appraised value approximately ${value:,}."},
            {"role": "assistant", "content": f"""The subject is Unit {unit} located at {addr}, {city}, {state} {random.randint(61700, 61799)}, situated in {county} County. The unit is a {sqft} square foot condominium in a {floors}-story building constructed in {year}. The project contains {random.randint(20, 200)} total units with a current occupancy rate of approximately {random.randint(85, 99)}%.

The neighborhood is characterized by {random.choice(['a mix of residential and commercial', 'predominantly residential', 'suburban residential'])} properties with property values that have been {random.choice(['stable', 'increasing', 'gradually increasing'])} over the past 12 months. Marketing times for comparable condominiums in the area range from {random.randint(15, 45)} to {random.randint(50, 120)} days.

The HOA fee of ${hoa} per month covers {random.choice(['exterior maintenance, common area upkeep, trash removal, and insurance on common elements', 'water/sewer, exterior maintenance, landscaping, snow removal, and master insurance', 'common area maintenance, landscaping, exterior building insurance, and reserve contributions'])}. The HOA financial statements indicate adequate reserve funding with no pending special assessments.

The highest and best use of the subject as improved is continued use as a residential condominium unit. The site is legally permissible, physically possible, financially feasible, and maximally productive in its current use.

Three comparable condominium sales were analyzed. Comparable 1 sold for ${random_value(value-30000, value+30000):,} and required a {random.choice(['positive', 'negative', 'net zero'])} adjustment for {random.choice(['superior location', 'inferior condition', 'larger living area', 'additional bathroom'])}. Comparable 2 sold for ${random_value(value-25000, value+25000):,} with adjustments for {random.choice(['floor level', 'garage parking', 'updated kitchen', 'view differences'])}. Comparable 3 sold for ${random_value(value-35000, value+35000):,} and was most similar to the subject requiring minimal adjustments.

After reconciliation of the comparable sales, with greatest weight given to Comparable {random.choice([1,2,3])} due to its {random.choice(['proximity and similar unit size', 'recent sale date and similar condition', 'location in the same complex'])}, the indicated market value of the subject is ${value:,} as of the effective date of this appraisal."""}
        ]
    }

def gen_manufactured_home():
    addr, city, state, county = random_address()
    value = random_value(40000, 180000)
    sqft = random_sqft(800, 2000)
    year = random.randint(1985, 2024)
    make = random.choice(["Clayton", "Champion", "Fleetwood", "Skyline", "Palm Harbor", "Cavco", "Redman"])
    width = random.choice(["single-wide", "double-wide"])
    
    return {
        "type": "manufactured_home",
        "source": "synthetic_v4",
        "messages": [
            {"role": "system", "content": CANONICAL_SYSTEM_PROMPT},
            {"role": "user", "content": f"Write the narrative sections for a 1004c manufactured home appraisal at {addr}, {city}, {state}. The subject is a {year} {make} {width} ({sqft} SF) on a permanent foundation. Appraised value approximately ${value:,}."},
            {"role": "assistant", "content": f"""The subject property is a {year} {make} {width} manufactured home located at {addr}, {city}, {state} {random.randint(61700, 61799)} in {county} County. The home contains {sqft} square feet of gross living area with {random_beds()} bedrooms and {random_baths()} bathrooms.

The manufactured home is installed on a permanent foundation system consisting of {random.choice(['a poured concrete perimeter foundation with anchor bolts', 'concrete block perimeter walls with steel tie-downs', 'a full poured concrete basement'])}. The HUD data plate and certification labels were {random.choice(['observed and photographed during inspection', 'verified through manufacturer records'])}. The home bears HUD label number {random.randint(1000000, 9999999)}.

The site is {random.choice(['owned in fee simple', 'leased — the subject is in a manufactured home community'])} and contains approximately {round(random.uniform(0.15, 2.0), 2)} acres. Utilities include {random.choice(['public water and sewer', 'private well and septic system', 'public water and private septic'])}.

The neighborhood is {random.choice(['a rural residential area', 'a suburban area with mixed housing types', 'a manufactured home community'])} where manufactured homes represent approximately {random.randint(10, 60)}% of the housing stock. Property values have been {random.choice(['stable', 'increasing slightly', 'mixed'])} over the past year.

The condition of the home is rated {random.choice(['C3 — well maintained with minor deferred maintenance', 'C4 — adequately maintained with some updating needed', 'C2 — recently renovated with modern updates'])}. {random.choice(['The kitchen and bathrooms have been updated within the past 5 years.', 'The home features original finishes in good condition for its age.', 'Recent improvements include new flooring, updated HVAC, and fresh interior paint.'])}

Three comparable sales of manufactured homes on permanent foundations were selected. Net adjustments did not exceed 15% and gross adjustments did not exceed 25% on any comparable. Greatest weight was given to Comparable {random.choice([1,2,3])} due to its {random.choice(['similar age, size, and foundation type', 'location in the immediate area and similar condition', 'most recent sale date and comparable design'])}. The sales comparison approach indicates a value of ${value:,} for the subject property."""}
        ]
    }

def gen_farm_appraisal():
    addr, city, state, county = random_address()
    acres = round(random.uniform(10, 320), 1)
    value = random_value(int(acres * 5000), int(acres * 15000))
    pi = round(random.uniform(100, 150), 1)
    
    return {
        "type": "farm_appraisal",
        "source": "synthetic_v4",
        "messages": [
            {"role": "system", "content": CANONICAL_SYSTEM_PROMPT},
            {"role": "user", "content": f"Write the narrative for an agricultural/farm appraisal of {acres} acres at {addr}, {city}, {state} in {county} County. Productivity index averages {pi}. Appraised value approximately ${value:,}."},
            {"role": "assistant", "content": f"""The subject is a {acres}-acre agricultural parcel located at {addr}, {city}, {state} in {county} County. The property is identified by PIN {random.randint(10, 30)}-{random.randint(10, 30)}-{random.randint(100, 400)}-{random.randint(1, 30):03d}.

The soils are predominantly {random.choice(['Drummer silty clay loam and Flanagan silt loam', 'Saybrook silt loam and Catlin silt loam', 'Elburn silt loam and Muscatune silt loam', 'Ipava silt loam and Sable silty clay loam'])} with an average productivity index of {pi}. The {county} County average PI is approximately {round(random.uniform(115, 140), 1)}. The subject's PI is {random.choice(['above', 'near', 'slightly below'])} the county average, indicating {random.choice(['highly productive', 'average', 'above average'])} agricultural capability.

Current land use is {random.choice(['100% tillable cropland', f'{random.randint(85, 98)}% tillable with the remainder in grass waterways and drainage easements', f'{random.randint(70, 90)}% tillable with {random.randint(5, 20)}% timber and the balance in homestead'])}. The property {random.choice(['has systematic tile drainage installed', 'has partial tile drainage', 'relies on surface drainage with some random tile'])}. Cash rent in the area for comparable productivity ranges from ${random.randint(200, 350)} to ${random.randint(350, 500)} per acre.

{random.choice([f'The property includes a {random.randint(1200, 2400)} SF farmhouse built in {random.randint(1900, 1980)} and a {random.randint(2000, 6000)} SF machine shed.', 'The property is unimproved bare farmland with no structures.', f'Improvements include a {random.randint(40, 80)}-year-old farmhouse and outbuildings in {random.choice(["fair", "average", "poor"])} condition. The contributory value of improvements is minimal.'])}

Three comparable agricultural sales were analyzed ranging from ${round(random.uniform(8000, 14000)):,} to ${round(random.uniform(10000, 16000)):,} per acre. Adjustments were made for productivity index differences, improvements, location, and sale conditions. The income approach using a {round(random.uniform(2.5, 4.5), 1)}% capitalization rate applied to the estimated net operating income of ${round(acres * random.uniform(200, 400)):,} supports the sales comparison conclusion.

Based on reconciliation of both approaches, with primary emphasis on the sales comparison approach, the market value of the subject is ${value:,}, or approximately ${round(value/acres):,} per acre."""}
        ]
    }

def gen_commercial_lease():
    addr, city, state, county = random_address()
    sqft = random.randint(2000, 50000)
    value = random_value(200000, 5000000)
    prop_type = random.choice(["office", "retail", "industrial/warehouse", "mixed-use"])
    
    return {
        "type": "commercial_lease",
        "source": "synthetic_v4",
        "messages": [
            {"role": "system", "content": CANONICAL_SYSTEM_PROMPT},
            {"role": "user", "content": f"Write the income approach and reconciliation for a commercial {prop_type} appraisal at {addr}, {city}, {state}. {sqft:,} SF, appraised value approximately ${value:,}."},
            {"role": "assistant", "content": f"""The subject is a {sqft:,} square foot {prop_type} property located at {addr}, {city}, {state} in {county} County. The income approach to value was given significant weight in this analysis given the property's investment-grade characteristics.

Market rent for comparable {prop_type} space in the {city} market area ranges from ${round(random.uniform(6, 25), 2)} to ${round(random.uniform(10, 35), 2)} per square foot on a {random.choice(['triple net (NNN)', 'modified gross', 'full service gross'])} basis. Based on analysis of {random.randint(4, 8)} comparable leases, the estimated market rent for the subject is ${round(random.uniform(8, 28), 2)} per square foot, yielding a potential gross income of ${round(sqft * random.uniform(8, 28)):,}.

Vacancy and collection loss is estimated at {round(random.uniform(3, 15), 1)}% based on current market conditions in the {city} {prop_type} market. The current vacancy rate for comparable properties is approximately {round(random.uniform(2, 12), 1)}%.

Operating expenses include real estate taxes (${round(random.uniform(1.5, 5.0), 2)}/SF), insurance (${round(random.uniform(0.25, 1.5), 2)}/SF), management ({round(random.uniform(3, 8), 1)}% of EGI), maintenance and repairs, and reserves for replacement. Total operating expenses are estimated at ${round(sqft * random.uniform(3, 12)):,}, resulting in a net operating income of ${round(sqft * random.uniform(5, 18)):,}.

The overall capitalization rate is derived from {random.randint(4, 7)} comparable sales ranging from {round(random.uniform(5.5, 9.5), 2)}% to {round(random.uniform(7.0, 11.0), 2)}%. A rate of {round(random.uniform(6.0, 9.5), 2)}% is applied to the subject, reflecting its {random.choice(['favorable location and stable tenancy', 'age and condition relative to newer competition', 'strong occupancy history and below-market lease terms'])}.

The income approach indicates a value of ${value:,} for the subject property. This conclusion is well-supported by the sales comparison approach which indicated a range of ${random_value(int(value*0.9), int(value*1.1)):,} to ${random_value(int(value*0.95), int(value*1.05)):,}."""}
        ]
    }

def gen_va_appraisal():
    addr, city, state, county = random_address()
    value = random_value(100000, 400000)
    sqft = random_sqft()
    beds = random_beds()
    baths = random_baths()
    year = random_year()
    
    return {
        "type": "va_appraisal",
        "source": "synthetic_v4",
        "messages": [
            {"role": "system", "content": CANONICAL_SYSTEM_PROMPT},
            {"role": "user", "content": f"Write the narrative sections for a VA appraisal (using Lender's Handbook Chapter 10 requirements) of {addr}, {city}, {state}. {beds}BR/{baths}BA, {sqft} SF, built {year}. Appraised value approximately ${value:,}."},
            {"role": "assistant", "content": f"""The subject property is located at {addr}, {city}, {state} {random.randint(61700, 61799)} in {county} County. This VA appraisal is completed in accordance with VA Lender's Handbook Chapter 10 and Circular 26-20-25 requirements.

The dwelling is a {beds}-bedroom, {baths}-bathroom {random.choice(['one-story', 'two-story', 'split-level', 'bi-level'])} residence containing {sqft} square feet of gross living area, constructed in {year}. The property sits on a {round(random.uniform(0.15, 0.75), 2)}-acre lot in a {random.choice(['suburban', 'urban', 'semi-rural'])} setting.

Per VA requirements, the property meets minimum property requirements (MPRs). The dwelling is {random.choice(['structurally sound with no observable deficiencies', 'in good overall condition with only minor cosmetic items noted', 'adequately maintained — the roof, mechanical systems, and structure are functional'])}. {random.choice(['No health or safety hazards were observed.', 'Minor peeling paint was noted on the exterior trim; this does not constitute a deficiency requiring repair for VA purposes given the age of the home.', 'All utilities were functional at the time of inspection.'])}

The property provides adequate living space for the intended occupancy. {random.choice(['The layout is functional with a logical floor plan.', 'Room sizes meet VA requirements for habitability.', 'The bedroom sizes and bathroom count are adequate for the market area.'])}

The sales comparison approach utilized three comparable sales. Adjustments were applied per VA guidelines — net adjustments are within 15% and gross adjustments within 25% of each comparable sale price. The market data supports the value conclusion with an adequate number of recent, proximate sales.

Based on the analysis, the reasonable value of the subject property is ${value:,} as of the effective date. This value reflects the property's competitive position in the current market and compliance with VA appraisal requirements."""}
        ]
    }

def gen_market_analysis():
    city, state, county = random.choice(IL_CITIES)
    
    return {
        "type": "market_analysis",
        "source": "synthetic_v4",
        "messages": [
            {"role": "system", "content": CANONICAL_SYSTEM_PROMPT},
            {"role": "user", "content": f"Write the neighborhood and market conditions analysis for a residential appraisal in {city}, {state} ({county} County)."},
            {"role": "assistant", "content": f"""The subject neighborhood is located in the {random.choice(['north', 'south', 'east', 'west', 'central'])} portion of {city}, {county} County, Illinois. The neighborhood boundaries are {random.choice(['well-defined by major arterials', 'generally defined by school district boundaries', 'established by natural features and land use transitions'])}.

The area is characterized by {random.choice(['single-family residential properties built primarily in the 1960s-1990s', 'a mix of housing ages ranging from the early 1900s to new construction', 'newer subdivision development from the 2000s-present'])}. Property values range from approximately ${random_value(80000, 150000):,} to ${random_value(250000, 500000):,}. The predominant value range is ${random_value(120000, 200000):,} to ${random_value(200000, 350000):,}.

Over the past 12 months, the market has been {random.choice(['stable with slight appreciation', 'moderately appreciating', 'balanced between buyers and sellers'])}. Median sale prices {random.choice(['increased approximately 3-5%', 'remained relatively stable', 'showed modest gains of 2-4%'])} compared to the prior year period. Average marketing time for the area is {random.randint(20, 60)} to {random.randint(45, 120)} days, with a current listing-to-sale price ratio of approximately {round(random.uniform(95, 100), 1)}%.

Active listings inventory suggests approximately {round(random.uniform(1.5, 6.0), 1)} months of supply. {random.choice(['This indicates a seller-favorable market with limited inventory.', 'This represents a balanced market condition.', 'Inventory levels have been declining over the past 6 months.'])} The sale-to-list price ratio and average days on market both support {random.choice(['strong', 'stable', 'moderate'])} demand.

{random.choice([f'The area is served by {city} Unit {random.randint(1, 10)} School District and is proximate to Illinois State University.', f'Employment is anchored by {random.choice(["State Farm Insurance", "Country Financial", "Caterpillar", "OSF Healthcare", "Carle Health", "the University of Illinois"])}.', f'The neighborhood benefits from proximity to {random.choice(["Interstate 74", "Interstate 55", "Interstate 39", "Route 66", "Veterans Parkway"])} providing convenient access to regional employment and retail.'])}

No adverse conditions were noted that would affect marketability or value of properties in this neighborhood."""}
        ]
    }

def gen_hbu_analysis():
    addr, city, state, county = random_address()
    zoning = random.choice(["R-1", "R-2", "R-3", "A-1", "C-1", "C-2", "PD"])
    
    return {
        "type": "hbu_analysis",
        "source": "synthetic_v4",
        "messages": [
            {"role": "system", "content": CANONICAL_SYSTEM_PROMPT},
            {"role": "user", "content": f"Write the highest and best use analysis for a residential property at {addr}, {city}, {state}. Current zoning: {zoning}."},
            {"role": "assistant", "content": f"""The highest and best use analysis considers four criteria: legal permissibility, physical possibility, financial feasibility, and maximum productivity.

**As Vacant:** The site is zoned {zoning} by the {random.choice(['City of ' + city, county + ' County'])} which permits {random.choice(['single-family residential use', 'single and two-family residential use', 'agricultural and residential use', 'residential use at various densities'])}. The site is physically suitable for development given its {random.choice(['level topography', 'gently rolling terrain', 'adequate size and shape'])} and access to {random.choice(['all public utilities', 'public water and sewer', 'municipal services'])}. Given current land values and construction costs in the {city} market, residential development is financially feasible. The highest and best use as vacant is for {random.choice(['single-family residential development', 'residential development consistent with surrounding uses', 'development with a single-family dwelling consistent with zoning'])}.

**As Improved:** The existing improvements represent a {random.choice(['legally conforming', 'legal non-conforming', 'legally permitted'])} use of the site. The improvements {random.choice(['contribute value in excess of the vacant land value', 'are consistent with market expectations for the area', 'represent a reasonable improvement given the site characteristics'])}. {random.choice(['No alternative use would generate a higher return.', 'Demolition and redevelopment is not financially warranted at this time.', 'The current improvements are the optimal use given market conditions.'])} The highest and best use as improved is continued residential use as currently improved.

The subject's current use as a {random.choice(['single-family residence is consistent with', 'residential dwelling conforms to', 'improved residential property is aligned with'])} the highest and best use conclusion."""}
        ]
    }

def gen_condition_quality():
    addr, city, state, county = random_address()
    cond = random.choice(["C2", "C3", "C4", "C5"])
    qual = random.choice(["Q2", "Q3", "Q4", "Q5"])
    year = random_year()
    
    cond_desc = {"C2": "recently renovated", "C3": "well-maintained", "C4": "adequately maintained", "C5": "showing deferred maintenance"}
    qual_desc = {"Q2": "high quality", "Q3": "above average", "Q4": "average", "Q5": "below average"}
    
    return {
        "type": "condition_quality",
        "source": "synthetic_v4",
        "messages": [
            {"role": "system", "content": CANONICAL_SYSTEM_PROMPT},
            {"role": "user", "content": f"Assign and explain Fannie Mae condition and quality ratings for a {year}-built residence at {addr}, {city}, {state}. The home is {cond_desc[cond]} with {qual_desc[qual]} materials and workmanship."},
            {"role": "assistant", "content": f"""The subject property at {addr}, {city}, {state} is assigned a condition rating of {cond} and a quality rating of {qual} per Fannie Mae Selling Guide Exhibit B-6.

**Condition Rating: {cond}**
{{"C2": f"The property has been recently renovated with significant updates completed. Improvements observed include {{random.choice(['new kitchen with granite countertops and stainless appliances, updated bathrooms, new flooring throughout', 'complete kitchen and bathroom remodel, new HVAC system, updated electrical panel', 'major renovation including new roof, windows, kitchen, and bathrooms within the past 2-3 years'])}}. The home shows minimal wear and all systems are in excellent working condition. Only minor cosmetic maintenance items typical of any occupied dwelling were noted.",
"C3": f"The property is well-maintained with no significant deferred maintenance observed. {{random.choice(['All major systems including HVAC, roof, and plumbing appear functional with remaining useful life.', 'The home has been consistently maintained with periodic updates. Recent improvements include new carpet and interior paint.', 'Minor cosmetic updates may be desired but are not required. The overall condition reflects attentive ownership.'])}} Some normal wear consistent with the age and use of the property is present but does not affect habitability or marketability.",
"C4": f"The property is adequately maintained with some deferred maintenance and minor repairs needed. {{random.choice(['The exterior shows some peeling paint and the driveway has minor cracking. Interior finishes show normal wear.', 'The kitchen and bathrooms are dated but functional. Some carpet shows wear patterns. HVAC system is original but operational.', 'Minor deferred items include worn floor coverings, dated light fixtures, and cosmetic updates needed in bathrooms.'])}} No significant structural issues were observed. The home is habitable in its current condition.",
"C5": f"The property shows significant deferred maintenance requiring attention. {{random.choice(['Observed items include worn roofing materials nearing end of useful life, peeling exterior paint, outdated electrical system, and dated plumbing fixtures.', 'The home needs substantial updating including kitchen and bathrooms, HVAC replacement, and exterior maintenance.', 'Deferred maintenance items include original mechanical systems at or past life expectancy, worn flooring, and exterior repairs needed.'])}} While habitable, the property would benefit from renovation to compete with market expectations."}}[cond]

**Quality Rating: {qual}**
{{"Q2": f"Construction quality is above the standard for the market area. Materials and finishes include {{random.choice(['hardwood flooring, custom cabinetry, high-end appliances, and detailed millwork', 'brick exterior, dimensional roof, solid wood doors, and designer fixtures', 'premium materials throughout including natural stone, custom tile work, and upgraded mechanical systems'])}}. The overall design and execution reflect attention to detail beyond typical tract housing.",
"Q3": f"Construction quality is above average for the area. The home features {{random.choice(['upgraded finishes including hardwood or engineered hardwood floors, solid surface countertops, and quality cabinetry', 'brick and frame exterior, above-average trim package, and better-than-standard fixtures', 'quality materials and workmanship that exceed minimum standards, including upgraded windows and insulation'])}}. The design provides a functional and attractive floor plan.",
"Q4": f"Construction quality is typical for the market area. Materials and finishes include {{random.choice(['vinyl or laminate flooring, builder-grade cabinetry, and standard fixtures', 'frame construction with vinyl siding, standard windows, and basic trim package', 'conventional construction methods and materials consistent with tract housing in the area'])}}. The quality is adequate and consistent with competing properties in the price range.",
"Q5": f"Construction quality is below average for the market area. {{random.choice(['Materials are basic and some show evidence of lower-grade products. Construction methods are adequate but lack refinement.', 'The home features economy-grade materials and basic construction. Finishes are minimal with limited detail.', 'Builder-grade or economy materials throughout. The construction is functional but lacks the quality found in typical competing homes.'])}} The quality rating reflects the actual materials and workmanship observed, which are below the predominant level for the neighborhood."}}[qual]

These ratings are consistent with the FNMA definitions and supported by observed property characteristics during the inspection on the effective date of this appraisal."""}
        ]
    }

def gen_adjustment_methodology():
    addr, city, state, county = random_address()
    
    return {
        "type": "adjustment_methodology",
        "source": "synthetic_v4",
        "messages": [
            {"role": "system", "content": CANONICAL_SYSTEM_PROMPT},
            {"role": "user", "content": f"Explain the adjustment methodology used in the sales comparison approach for a residential appraisal in {city}, {state}."},
            {"role": "assistant", "content": f"""Adjustments in the sales comparison approach are derived from paired sales analysis, market extraction, and the appraiser's knowledge of the local market. All adjustments reflect the actions of typical buyers and sellers in the {city}, {county} County market area.

**Location:** Location adjustments are based on analysis of sales in different neighborhoods and subdivisions. Factors considered include school districts, proximity to amenities, traffic patterns, and neighborhood desirability. Typical location adjustments in this market range from $0 to ${random.randint(5, 20)},{random.randint(0,9)}00.

**GLA (Gross Living Area):** The GLA adjustment is derived from paired sales analysis indicating a rate of approximately ${random.randint(20, 60)} per square foot for differences in living area. This rate is applied on a diminishing return basis — larger adjustments may be discounted when the differential exceeds {random.randint(15, 25)}% of the subject's GLA.

**Age/Condition:** Adjustments for effective age and condition are based on observed differences and paired sales extraction. A newly renovated ({random.choice(['C2', 'C3'])}) comparable versus an older ({random.choice(['C4', 'C5'])}) property typically warrants a ${random.randint(5, 25)},{random.randint(0,9)}00 adjustment in this market and price range.

**Basement:** Finished basement area is adjusted at approximately ${random.randint(15, 35)} per square foot, which is less than the above-grade GLA rate reflecting typical market behavior. An unfinished basement adds approximately ${random.randint(5, 15)} per square foot over a slab or crawl space foundation.

**Garage:** A standard two-car attached garage contributes approximately ${random.randint(8, 20)},{random.randint(0,9)}00 in this market. Three-car garages command a premium of ${random.randint(3, 10)},{random.randint(0,9)}00 over two-car.

All net adjustments are within 15% and gross adjustments within 25% of each comparable sale price, consistent with Fannie Mae guidelines. Where adjustments approach these thresholds, additional comparable data was analyzed to verify the adjustment amounts."""}
        ]
    }

def gen_multifamily_1025():
    addr, city, state, county = random_address()
    units = random.choice([2, 3, 4])
    value = random_value(150000, 600000)
    
    return {
        "type": "multifamily_1025",
        "source": "synthetic_v4",
        "messages": [
            {"role": "system", "content": CANONICAL_SYSTEM_PROMPT},
            {"role": "user", "content": f"Write the narrative sections for a FNM1025 small residential income property appraisal of a {units}-unit at {addr}, {city}, {state}. Appraised value approximately ${value:,}."},
            {"role": "assistant", "content": f"""The subject is a {units}-unit residential income property located at {addr}, {city}, {state} {random.randint(61700, 61799)} in {county} County. The property is a {random.choice(['two-story frame', 'converted single-family', 'purpose-built multi-unit'])} structure built in {random.randint(1920, 2010)}.

The unit mix consists of {' and '.join([f'{random.choice([1,2,3])}-bedroom/{random.choice([1, 1.5, 2])}-bath units' for _ in range(min(units, 3))])}. Total gross building area is approximately {random.randint(2000, 5000)} square feet. Each unit has {random.choice(['separate electric meters', 'individual utility connections', 'sub-metered utilities'])} with the {random.choice(['owner', 'tenants'])} responsible for {random.choice(['gas and electric', 'all utilities except water/sewer', 'electric only'])}. 

Current rents range from ${random.randint(500, 800)} to ${random.randint(750, 1200)} per month per unit. Market rent analysis based on {random.randint(4, 8)} comparable rentals indicates market rent of ${random.randint(600, 1000)} to ${random.randint(800, 1300)} per unit. Current rents are {random.choice(['at market levels', 'slightly below market, suggesting upside potential', 'consistent with market expectations for the condition and amenities'])}. Total potential gross income is approximately ${random.randint(units * 7000, units * 15000):,} annually.

Vacancy and collection loss is estimated at {round(random.uniform(3, 10), 1)}% based on current area conditions. Operating expenses including taxes, insurance, maintenance, and management total approximately ${random.randint(5000, 15000):,} annually, resulting in a net operating income of approximately ${random.randint(15000, 45000):,}.

The income approach using a {round(random.uniform(7, 12), 1)}% GRM-derived capitalization rate indicates a value of ${value:,}. The sales comparison approach, utilizing {random.choice(['three', 'four'])} comparable {units}-unit sales, indicates a value range of ${random_value(int(value*0.92), int(value*1.08)):,} to ${random_value(int(value*0.95), int(value*1.05)):,}. Greatest weight is given to the {random.choice(['income', 'sales comparison'])} approach as typical buyers of investment properties focus on {random.choice(['income-producing potential', 'both rental income and market comparisons'])}. The reconciled value is ${value:,}."""}
        ]
    }

# Map generators to types
GENERATORS = {
    "condo_appraisal": gen_condo_appraisal,
    "manufactured_home": gen_manufactured_home,
    "farm_appraisal": gen_farm_appraisal,
    "commercial_lease": gen_commercial_lease,
    "va_appraisal": gen_va_appraisal,
    "market_analysis": gen_market_analysis,
    "hbu_analysis": gen_hbu_analysis,
    "condition_quality": gen_condition_quality,
    "adjustment_methodology": gen_adjustment_methodology,
    "multifamily_1025": gen_multifamily_1025,
}

# Also generate more for types that exist but are underrepresented
UNDERREP_GENERATORS = {
    "site_valuation": gen_hbu_analysis,  # reuse HBU with different type tag
    "flood_zone": gen_market_analysis,
    "zoning": gen_hbu_analysis,
    "environmental": gen_market_analysis,
    "scope_of_work": gen_market_analysis,
    "inspection_details": gen_condition_quality,
}

def main():
    print("=" * 60)
    print("Building V4 Training Data")
    print("=" * 60)
    
    # Load v3
    train_v3 = load_jsonl(TRAINING_DIR / "train_v3.jsonl")
    val_v3 = load_jsonl(TRAINING_DIR / "val_v3.jsonl")
    print(f"\nLoaded: {len(train_v3)} train, {len(val_v3)} val from v3")
    
    # Step 1: Combine all and unify system prompts
    all_examples = train_v3 + val_v3
    print(f"Combined: {len(all_examples)} total examples")
    
    for ex in all_examples:
        unify_system_prompt(ex)
    print("Unified all system prompts to canonical version")
    
    # Step 2: Deduplicate
    before_dedup = len(all_examples)
    all_examples = deduplicate(all_examples)
    print(f"Deduplication: {before_dedup} -> {len(all_examples)} ({before_dedup - len(all_examples)} removed)")
    
    # Step 3: Count categories
    type_counts = Counter(ex.get('type', 'unknown') for ex in all_examples)
    print(f"\nCategory distribution after dedup:")
    for t, c in type_counts.most_common():
        print(f"  {t}: {c}")
    
    # Step 4: Generate synthetic examples for underrepresented categories
    TARGET_MIN = 20
    synthetic_added = 0
    
    for cat_type, generator in GENERATORS.items():
        current = type_counts.get(cat_type, 0)
        needed = max(0, TARGET_MIN - current)
        if needed > 0:
            print(f"\nGenerating {needed} synthetic examples for '{cat_type}' (had {current})")
            for _ in range(needed):
                all_examples.append(generator())
                synthetic_added += 1
    
    # Also boost some underrep categories
    for cat_type, generator in UNDERREP_GENERATORS.items():
        current = type_counts.get(cat_type, 0)
        needed = max(0, 10 - current)
        if needed > 0:
            for _ in range(needed):
                ex = generator()
                ex['type'] = cat_type
                all_examples.append(ex)
                synthetic_added += 1
    
    print(f"\nTotal synthetic examples added: {synthetic_added}")
    print(f"Total dataset size: {len(all_examples)}")
    
    # Step 5: Shuffle and split 90/10
    random.shuffle(all_examples)
    
    val_size = max(int(len(all_examples) * 0.1), 50)
    
    # Ensure no val leakage — val examples must have unique questions
    train_questions = set()
    train_set = []
    val_set = []
    
    for ex in all_examples:
        h = content_hash(ex)
        if len(val_set) < val_size and h not in train_questions:
            val_set.append(ex)
        else:
            train_questions.add(h)
            train_set.append(ex)
    
    print(f"\nFinal split: {len(train_set)} train, {len(val_set)} val")
    
    # Verify no leakage
    val_hashes = set(content_hash(ex) for ex in val_set)
    train_hashes = set(content_hash(ex) for ex in train_set)
    leakage = val_hashes & train_hashes
    print(f"Validation leakage check: {len(leakage)} overlapping questions (should be 0)")
    
    # Step 6: Final stats
    final_types = Counter(ex.get('type', 'unknown') for ex in train_set)
    print(f"\nFinal training category distribution:")
    for t, c in final_types.most_common():
        print(f"  {t}: {c}")
    
    final_sources = Counter(ex.get('source', 'unknown') for ex in train_set)
    print(f"\nSource distribution:")
    for s, c in final_sources.most_common():
        print(f"  {s}: {c}")
    
    # Save
    train_path = TRAINING_DIR / "train_v4.jsonl"
    val_path = TRAINING_DIR / "val_v4.jsonl"
    save_jsonl(train_set, train_path)
    save_jsonl(val_set, val_path)
    print(f"\nSaved: {train_path}")
    print(f"Saved: {val_path}")
    
    # Also prep RunPod package
    runpod_dir = TRAINING_DIR / "runpod_v4_package"
    runpod_dir.mkdir(exist_ok=True)
    save_jsonl(train_set, runpod_dir / "train_v4.jsonl")
    save_jsonl(val_set, runpod_dir / "val_v4.jsonl")
    print(f"\nRunPod package: {runpod_dir}")
    
    print("\n" + "=" * 60)
    print("V4 BUILD COMPLETE")
    print("=" * 60)

if __name__ == "__main__":
    main()
