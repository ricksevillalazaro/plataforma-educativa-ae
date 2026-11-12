import re
with open('src/components/academic/AcademicStructureManager.tsx', 'r') as f:
    content = f.read()

# Remove all bad ListTodos
content = content.replace("import { ListTodo, ", "import { ")

# Add it specifically to lucide-react
content = re.sub(r"import \{(.*?)\} from 'lucide-react';", r"import {\1, ListTodo} from 'lucide-react';", content, flags=re.DOTALL)

with open('src/components/academic/AcademicStructureManager.tsx', 'w') as f:
    f.write(content)
