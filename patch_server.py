import re

with open('server.ts', 'r') as f:
    content = f.read()

target = r"""      if \(apiKey\) \{
        // Try Gemini models with automatic error handling
        const modelsToTry = \['gemini-3.7-flash', 'gemini-flash-latest'\];.*?\}
        \}
      \}"""

replacement = """      if (apiKey) {
        // Try Gemini models with automatic error handling
        const modelsToTry = ['gemini-2.5-pro', 'gemini-3.7-flash', 'gemini-flash-latest'];

        for (const modelName of modelsToTry) {
          try {
            const ai = new GoogleGenAI({
              apiKey,
              httpOptions: {
                headers: {
                  'User-Agent': 'aistudio-build',
                },
              },
            });

            const prompt = `
Actúa como un Diseñador Curricular y Pedagogo Experto.
Genera un recurso de material didáctico integral, estructurado e interactivo para los estudiantes, basándote en las directrices del docente y EXTRALLENDO la información de las URLs de fuentes consultadas suministradas.

INFORMACIÓN DE LA SESIÓN:
- Asignatura: ${subject || courseName || 'General'}
- Curso / Grado: ${courseName || ''} - ${gradeLevel || 'Secundaria'}
- Semana / Sesión: Semana ${weekNumber || 1}, Sesión ${sessionNumber || 1}
- Título de la Sesión: ${sessionTitle}
- Tema Central: ${topic}
- Propósito Pedagógico: ${pedagogicalGoal || 'Desarrollar comprensión profunda y aplicación práctica'}
- Pauta DUA: ${duaStrategy || 'Múltiples formas de representación y acción'}
- Estilo Pedagógico Solicitado: ${pedagogicalStyle}

ORIENTACIÓN / DESCRIPCIÓN DEL DOCENTE:
${description || 'Estructurar el tema con claridad, usando pestañas dinámicas con bloques interactivos.'}

FUENTES / ENLACES INGRESADOS POR EL DOCENTE (MUY IMPORTANTE EXTRAER DE AQUÍ):
${sourceUrls.length > 0 ? sourceUrls.map((url, i) => \`\${i + 1}. \${url}\`).join('\\n') : 'Sin URLs externas específicas (utilizar conocimiento pedagógico especializado).'}

REQUISITOS DEL CONTENIDO (ESTRUCTURA DE PESTAÑAS - TABS):
Debes generar el contenido utilizando una estructura moderna de "pestañas" (tabs). Genera entre 3 y 5 pestañas organizadas lógicamente según el tema (ej. "1. Conceptos Básicos", "2. Las Fases", "3. Caso Práctico", etc.).
Para cada pestaña, define qué bloques de contenido (blocks) incluir.

Tipos de bloques disponibles para usar dentro de las pestañas:
1. 'theory' (Teoría): Para texto explicativo. (Campos: title, content, opcional: quote)
2. 'quick_check' (Comprobación rápida): Pregunta de opción múltiple. (Campos: question, options (array de strings), correctIndex (número 0-N), explanation, opcional hint)
3. 'phase_cycle' (Ciclo de fases): Para procesos o pasos. (Campos: title, phases (array con name, question, description, actions (array de strings)))
4. 'matching_game' (Juego de unir): Relacionar casos. (Campos: title, cases (array con scenario y correctPhase), options (array de strings con las posibles fases))
5. 'case_study' (Caso práctico): Para análisis de casos. (Campos: title, company, subtitle, content, keyInnovation, phases (array con title e items (array de strings)))
6. 'simulator' (Simulador): Formulario interactivo. (Campos: title, description, fields (array con label y placeholder), buttonText)
7. 'glossary' (Glosario): (Campos: terms (array con term, definition, opcional category))
8. 'practical_example' (Ejemplo práctico): (Campos: items (array con title, scenario, stepByStep (array de strings), takeaway))
9. 'activities' (Actividades): (Campos: items (array con title, instructions, durationMinutes, modality, deliverable))
10. 'sources' (Fuentes): (Campos: items (array con title, url))

Genera el resultado en un JSON estricto con la siguiente estructura:
{
  "summary": "Resumen general de la sesión (2-3 líneas)",
  "tabs": [
    {
      "id": "tab-1",
      "title": "1. Nombre de Pestaña",
      "icon": "Book",
      "blocks": [
        {
          "type": "theory",
          "title": "...",
          "content": "..."
        }
      ]
    }
  ]
}
`;

            const response = await ai.models.generateContent({
              model: modelName,
              contents: prompt,
              config: {
                responseMimeType: 'application/json',
                tools: sourceUrls.length > 0 ? [{ googleSearch: {} }] : undefined,
              },
            });

            const textResponse = response.text || '{}';
            const parsedData = JSON.parse(textResponse);

            return res.json({
              success: true,
              didacticContent: {
                generatedAt: new Date().toISOString(),
                sourceUrls,
                teacherPrompt: description,
                pedagogicalStyle,
                summary: parsedData.summary || `Contenido didáctico generado para la sesión: ${sessionTitle}`,
                tabs: parsedData.tabs || [],
                theoreticalFramework: { title: topic, content: '', keyConcepts: [] },
                practicalExamples: [],
                studentActivities: [],
                checkUnderstandingQuestions: []
              }
            });
          } catch (geminiError: any) {
            console.warn(`Attempt with ${modelName} encountered rate limit / overload. Trying fallback options.`);
          }
        }
      }"""

new_content = re.sub(target, replacement, content, flags=re.DOTALL)
with open('server.ts', 'w') as f:
    f.write(new_content)
