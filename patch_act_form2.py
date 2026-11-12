import re
with open('src/components/activities/ActivityFormModal.tsx', 'r') as f:
    content = f.read()

content = content.replace("interface ActivityFormModalProps {\n  activityToEdit?: Activity | null;\n  onClose: () => void;\n}", "interface ActivityFormModalProps {\n  activityToEdit?: Activity | null;\n  onClose: () => void;\n  defaultSessionIds?: string[];\n}")

content = re.sub(
    r"const \[sessionIds, setSessionIds\] = useState<string\[\]>\([^)]*\);",
    "const [sessionIds, setSessionIds] = useState<string[]>(activityToEdit?.sessionIds || defaultSessionIds || []);",
    content
)

with open('src/components/activities/ActivityFormModal.tsx', 'w') as f:
    f.write(content)
