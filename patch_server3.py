with open('server.ts', 'r') as f:
    content = f.read()

# inside ws.on('message', ...) block, we have req.body.initialSections || [] -> message.initialSections
start_idx = content.find("ws.on('message',")
if start_idx != -1:
    before = content[:start_idx]
    after = content[start_idx:]
    after = after.replace("req.body.initialSections || []", "message.initialSections")
    content = before + after

with open('server.ts', 'w') as f:
    f.write(content)
