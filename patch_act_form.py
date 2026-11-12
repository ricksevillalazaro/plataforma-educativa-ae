import re
with open('src/components/activities/ActivityFormModal.tsx', 'r') as f:
    content = f.read()

content = content.replace("ProjectSection['type']", "AttachedResource['type']")

with open('src/components/activities/ActivityFormModal.tsx', 'w') as f:
    f.write(content)
