import re
with open('server.ts', 'r') as f:
    content = f.read()

content = content.replace("req.body.initialSections || []", "message.initialSections")
content = re.sub(r"app\.get\('/api/collaboration/:activityId/:groupId', \(req, res\) => \{\n    const \{ activityId, groupId \} = req\.params;\n    const room = getOrCreateRoom\(activityId, groupId, \"course-pc-01\", message\.initialSections\);", 
                 r"app.get('/api/collaboration/:activityId/:groupId', (req, res) => {\n    const { activityId, groupId } = req.params;\n    const room = getOrCreateRoom(activityId, groupId, \"course-pc-01\", []);", content)

content = re.sub(r"app\.post\('/api/collaboration/lock', \(req, res\) => \{[\s\S]*?getOrCreateRoom\(activityId, groupId, \"course-pc-01\", message\.initialSections\);",
                 lambda m: m.group(0).replace("message.initialSections", "req.body.initialSections || []"), content)

content = re.sub(r"app\.post\('/api/collaboration/unlock', \(req, res\) => \{[\s\S]*?getOrCreateRoom\(activityId, groupId, \"course-pc-01\", message\.initialSections\);",
                 lambda m: m.group(0).replace("message.initialSections", "req.body.initialSections || []"), content)

content = re.sub(r"app\.post\('/api/collaboration/update', \(req, res\) => \{[\s\S]*?getOrCreateRoom\(activityId, groupId, \"course-pc-01\", message\.initialSections\);",
                 lambda m: m.group(0).replace("message.initialSections", "req.body.initialSections || []"), content)

with open('server.ts', 'w') as f:
    f.write(content)
