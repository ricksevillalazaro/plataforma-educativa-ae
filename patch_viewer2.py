import re
with open('src/components/student/SessionDidacticContentView.tsx', 'r') as f:
    content = f.read()

import_stmt = "import { DidacticContentRenderer } from './DidacticContentRenderer';\n"
if 'DidacticContentRenderer' not in content[:500]:
    content = content.replace("import { BookOpen,", import_stmt + "import { BookOpen,")

with open('src/components/student/SessionDidacticContentView.tsx', 'w') as f:
    f.write(content)
