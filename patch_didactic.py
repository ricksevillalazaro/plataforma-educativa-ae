with open('src/components/student/SessionDidacticContentView.tsx', 'r') as f:
    content = f.read()

if 'import { DidacticContentRenderer }' not in content:
    content = content.replace("import React,", "import { DidacticContentRenderer } from './DidacticContentRenderer';\nimport React,")

with open('src/components/student/SessionDidacticContentView.tsx', 'w') as f:
    f.write(content)
