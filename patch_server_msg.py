import re
with open('server.ts', 'r') as f:
    content = f.read()

content = content.replace("message.initialSections", "req.body.initialSections || []")

with open('server.ts', 'w') as f:
    f.write(content)
