with open('src/components/academic/AcademicStructureManager.tsx', 'r') as f:
    content = f.read()

if 'import { ActivityFormModal }' not in content:
    content = content.replace("import { AcademicCriteriaModal } from './AcademicCriteriaModal';", "import { AcademicCriteriaModal } from './AcademicCriteriaModal';\nimport { ActivityFormModal } from '../activities/ActivityFormModal';")

if 'ListTodo' not in content[:300]:
    content = content.replace("import { Calendar,", "import { Calendar, ListTodo,")

with open('src/components/academic/AcademicStructureManager.tsx', 'w') as f:
    f.write(content)
