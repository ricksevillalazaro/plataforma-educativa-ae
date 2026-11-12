import re

with open('src/components/student/SessionDidacticContentView.tsx', 'r') as f:
    content = f.read()

# Add import
import_stmt = "import { DidacticContentRenderer } from './DidacticContentRenderer';\n"
if 'DidacticContentRenderer' not in content:
    content = content.replace("import { BookOpen,", import_stmt + "import { BookOpen,")

# Update activeSection state to string
content = content.replace("const [activeSection, setActiveSection] = useState<'teoria' | 'ejemplos' | 'retos' | 'quiz'>('teoria');", "const [activeSection, setActiveSection] = useState<string>('teoria');")

# Render dynamic tabs if content.tabs exists
nav_ribbon_regex = r"\{/\* Navigation Ribbon / Sub-nav \*/\}.*?\{/\* Text size selector for accessibility \*/\}"
dynamic_nav = """{/* Navigation Ribbon / Sub-nav */}
        <div className="bg-slate-50 px-6 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3 overflow-x-auto shrink-0">
          <div className="flex items-center gap-2 min-w-max">
            {content.tabs && content.tabs.length > 0 ? (
              content.tabs.map((tab, idx) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveSection(tab.id)}
                  className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    activeSection === tab.id || (idx === 0 && activeSection === 'teoria' && !content.tabs.find(t => t.id === 'teoria'))
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-white text-slate-700 hover:bg-slate-200/70 border border-slate-200'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>{tab.title}</span>
                </button>
              ))
            ) : (
              <>
                <button
                  onClick={() => setActiveSection('teoria')}
                  className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    activeSection === 'teoria'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-white text-slate-700 hover:bg-slate-200/70 border border-slate-200'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>1. Fundamentos & Conceptos</span>
                </button>

                <button
                  onClick={() => setActiveSection('ejemplos')}
                  className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    activeSection === 'ejemplos'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-white text-slate-700 hover:bg-slate-200/70 border border-slate-200'
                  }`}
                >
                  <Lightbulb className="w-3.5 h-3.5" />
                  <span>2. Ejemplos Prácticos ({content.practicalExamples?.length || 0})</span>
                </button>

                <button
                  onClick={() => setActiveSection('retos')}
                  className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    activeSection === 'retos'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-white text-slate-700 hover:bg-slate-200/70 border border-slate-200'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>3. Retos de Clase ({content.studentActivities?.length || 0})</span>
                </button>

                <button
                  onClick={() => setActiveSection('quiz')}
                  className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    activeSection === 'quiz'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
                  }`}
                >
                  <Award className="w-3.5 h-3.5" />
                  <span>4. Cuestionario de Autoevaluación ({content.checkUnderstandingQuestions?.length || 0})</span>
                </button>
              </>
            )}
          </div>

          {/* Text size selector for accessibility */}"""

content = re.sub(nav_ribbon_regex, dynamic_nav, content, flags=re.DOTALL)

# Dynamic tab rendering
content_section_regex = r"\{/\* SECTION 1: THEORETICAL FRAMEWORK & KEY CONCEPTS \*/\}.*?(?=</div>\s*</div>\s*</div>\s*\);\s*\};)"

dynamic_renderer = """
          {content.tabs && content.tabs.length > 0 ? (
            <div className="max-w-4xl mx-auto animate-in fade-in duration-150">
              {content.tabs.map((tab, idx) => {
                const isActive = activeSection === tab.id || (idx === 0 && activeSection === 'teoria' && !content.tabs.find(t => t.id === 'teoria'));
                if (!isActive) return null;
                
                return (
                  <div key={tab.id} className="space-y-6">
                    {idx === 0 && (
                      <div className="p-5 rounded-3xl bg-linear-to-br from-indigo-50 via-white to-indigo-50/40 border border-indigo-100/90 shadow-xs space-y-2 mb-6">
                        <div className="flex items-center gap-2 text-indigo-700 font-extrabold text-xs uppercase tracking-wider">
                          <Sparkles className="w-4 h-4 text-amber-500" />
                          <span>Resumen de la Sesión & Propósito</span>
                        </div>
                        <p className="text-slate-700 leading-relaxed font-medium">
                          {content.summary}
                        </p>
                      </div>
                    )}
                    <DidacticContentRenderer blocks={tab.blocks} />
                  </div>
                );
              })}
            </div>
          ) : (
            <>
"""

content = re.sub(r"\{/\* SECTION 1: THEORETICAL FRAMEWORK & KEY CONCEPTS \*/\}", dynamic_renderer + "{/* SECTION 1: THEORETICAL FRAMEWORK & KEY CONCEPTS */}", content, flags=re.DOTALL)

# Close the fallback fragment
content = re.sub(r"(</button>\s*</div>\s*</div>\s*)}", r"\1}\n            </>\n          )}", content)


with open('src/components/student/SessionDidacticContentView.tsx', 'w') as f:
    f.write(content)
