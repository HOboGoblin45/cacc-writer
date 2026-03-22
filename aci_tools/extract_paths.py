import re, json, os

with open(r'C:\Program Files (x86)\ACI32\Databases\ACI Track\Order.db', 'rb') as f:
    data = f.read()

# Extract all .ACI file paths
paths = re.findall(rb'\\USERS\\CCRES[^\x00\x01\x02]{5,500}?\.ACI', data, re.IGNORECASE)

seen = set()
unique_paths = []
for p in paths:
    decoded = p.decode('ascii', errors='replace')
    # Convert to proper Windows path
    win_path = 'C:' + decoded.replace('\\', os.sep)
    if win_path not in seen:
        seen.add(win_path)
        unique_paths.append(win_path)

print(f'Found {len(unique_paths)} unique ACI file paths')
for p in unique_paths[:30]:
    exists = os.path.exists(p)
    print(f'  {"[OK]" if exists else "[??]"} {p}')

# Save to file
with open(r'C:\Users\ccres\OneDrive\Desktop\cacc-writer\training_output\aci_paths.json', 'w') as f:
    json.dump({'paths': unique_paths, 'count': len(unique_paths)}, f, indent=2)

print(f'\nSaved to aci_paths.json')
