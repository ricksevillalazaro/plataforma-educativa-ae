import re
with open('src/components/academic/AcademicStructureManager.tsx', 'r') as f:
    content = f.read()

# Add the import
if 'ActivityFormModal' not in content:
    content = content.replace("import { AcademicCriteriaModal } from './AcademicCriteriaModal';", "import { AcademicCriteriaModal } from './AcademicCriteriaModal';\nimport { ActivityFormModal } from '../activities/ActivityFormModal';")

# Add the state
if 'sessionForNewActivity' not in content:
    content = content.replace("const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);", "const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);\n  const [sessionForNewActivity, setSessionForNewActivity] = useState<ClassSession | null>(null);")

# Add the button
btn_code = """
                                  <button
                                    onClick={() => setSessionForNewActivity(sess)}
                                    className="px-3.5 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                                  >
                                    <ListTodo className="w-3.5 h-3.5" />
                                    Crear Actividad
                                  </button>
"""
if 'Crear Actividad' not in content:
    content = content.replace("<button\n                                    onClick={() => setSelectedSessionForCriteria(sess)}", btn_code + "\n                                  <button\n                                    onClick={() => setSelectedSessionForCriteria(sess)}")

# Add the modal render
modal_code = """
      {/* Create Activity Modal */}
      {sessionForNewActivity && (
        <ActivityFormModal
          onClose={() => setSessionForNewActivity(null)}
          defaultSessionIds={[sessionForNewActivity.id]}
        />
      )}
"""
if 'sessionForNewActivity && (' not in content:
    content = content.replace("{/* --- MODAL: SESIÓN DE CLASE --- */}", modal_code + "\n      {/* --- MODAL: SESIÓN DE CLASE --- */}")

with open('src/components/academic/AcademicStructureManager.tsx', 'w') as f:
    f.write(content)
