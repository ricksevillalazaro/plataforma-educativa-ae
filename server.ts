import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-Memory Storage for Group Collaboration Rooms & Locks
interface ProjectSection {
  id: string;
  title: string;
  description: string;
  content: string;
  placeholder?: string;
  lastEditedBy?: {
    id: string;
    name: string;
    timestamp: string;
  };
  lockedBy?: {
    id: string;
    name: string;
    lockedAt: string;
  } | null;
}

interface CollaborationChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
}

interface GroupCollaborationState {
  activityId: string;
  groupId: string;
  courseId: string;
  sections: ProjectSection[];
  activeUsers: Array<{
    id: string;
    name: string;
    avatar?: string;
    activeSectionId?: string;
    lastPing: string;
  }>;
  iterationCount: number;
  chatMessages: CollaborationChatMessage[];
  isFinalSubmitted: boolean;
  finalSubmittedAt?: string;
  lastSyncTimestamp?: string;
}

const collaborationRooms = new Map<string, GroupCollaborationState>();
const roomSockets = new Map<string, Set<WebSocket>>();
const socketUserMap = new Map<WebSocket, { roomId: string; userId: string; userName: string }>();

function getOrCreateRoom(activityId: string, groupId: string, courseId: string = 'course-pc-01', initialSections?: ProjectSection[]): GroupCollaborationState {
  const roomKey = `${activityId}_${groupId}`;
  if (!collaborationRooms.has(roomKey)) {
    const defaultSections: ProjectSection[] = [
      {
        id: 'sec-problem',
        title: '1. Planteamiento del Problema & Justificación Contextual',
        description: 'Delimiten la necesidad real identificada, los beneficiarios directos y la hipótesis de solución tecnológica.',
        placeholder: 'Describan aquí el contexto, la problemática educativa o comunitaria y por qué este proyecto es relevante...',
        content: `### Contexto del Proyecto\nEn nuestra comunidad escolar hemos detectado la necesidad de optimizar los tiempos de respuesta y análisis en situaciones cotidianas mediante herramientas tecnológicas accesibles.\n\n### Problema Central\nLa falta de sistematización y control en tiempo real genera retrasos e inconsistencias en la toma de decisiones.\n\n### Propósito y Beneficiarios\nDesarrollar una solución estructurada que beneficie directamente a estudiantes y docentes, alineada con las pautas DUA.`,
        lockedBy: null
      },
      {
        id: 'sec-architecture',
        title: '2. Arquitectura del Sistema, Diagrama de Flujo & Componentes',
        description: 'Estructura modular del proyecto, entradas, transformaciones lógicas y salidas esperadas.',
        placeholder: 'Detallen los módulos lógicos, componentes de software y flujo de datos paso a paso...',
        content: `### Arquitectura Modular\n1. **Módulo de Entrada:** Captura y sanitización de datos de los usuarios.\n2. **Motor de Procesamiento:** Aplicación de algoritmos de ordenamiento y validación lógica.\n3. **Módulo de Salida & Visualización:** Presentación accesible mediante interfaz gráfica y reportes consolidados.`,
        lockedBy: null
      },
      {
        id: 'sec-solution',
        title: '3. Implementación / Código Fuente / Solución Técnica',
        description: 'Desarrollo técnico, algoritmos principales, funciones clave y documentación de código.',
        placeholder: 'Escriban el código, scripts o modelos funcionales del equipo...',
        content: `\`\`\`python\n# Solución Técnica desarrollada por el equipo\ndef procesar_datos_proyecto(datos):\n    # Validación y procesamiento sistemático\n    resultados = []\n    for item in datos:\n        if item.get("valido", True):\n            resultados.append(item)\n    return {"total_procesados": len(resultados), "items": resultados}\n\`\`\``,
        lockedBy: null
      },
      {
        id: 'sec-evidence',
        title: '4. Evidencias de Pruebas, Casos de Uso & Validación Empírica',
        description: 'Casos de prueba ejecutados, métricas de desempeño, resultados obtenidos y depuración.',
        placeholder: 'Registren los casos de prueba ejecutados y sus resultados de validación...',
        content: `### Tabla de Casos de Prueba\n- **Caso 1 (Entrada Estándar):** Ejecución exitosa con tiempo de respuesta < 50ms.\n- **Caso 2 (Valores Límite):** Manejo controlado de excepciones sin interrupción del servicio.\n- **Caso 3 (Accesibilidad DUA):** Verificación de contrastes y legibilidad en lectores de pantalla.`,
        lockedBy: null
      },
      {
        id: 'sec-reflection',
        title: '5. Conclusiones, Reflexión DUA & Autoevaluación del Equipo',
        description: 'Síntesis de aprendizajes alcanzados, dificultades superadas y roles asumidos en la iteración.',
        placeholder: 'Sinteticen sus aprendizajes clave y la contribución de cada integrante...',
        content: `### Reflexión Pedagógica\nEl trabajo colaborativo e iterativo nos permitió identificar fallos tempranos y perfeccionar la propuesta con la retroalimentación del docente. Cada integrante asumió un rol activo según sus fortalezas.`,
        lockedBy: null
      }
    ];

    collaborationRooms.set(roomKey, {
      activityId,
      groupId,
      courseId,
      sections: initialSections || defaultSections,
      activeUsers: [],
      iterationCount: 1,
      chatMessages: [
        {
          id: 'chat-welcome',
          senderId: 'system',
          senderName: 'Asistente Colaborativo',
          text: 'Espacio de trabajo en tiempo real activado. Bloqueen las secciones antes de editar para evitar sobreescritura.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ],
      isFinalSubmitted: false,
      lastSyncTimestamp: new Date().toISOString()
    });
  }
  return collaborationRooms.get(roomKey)!;
}

function broadcastToRoom(roomKey: string, message: any, excludeWs?: WebSocket) {
  const sockets = roomSockets.get(roomKey);
  if (!sockets) return;
  const jsonPayload = JSON.stringify(message);
  sockets.forEach((client) => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      try {
        client.send(jsonPayload);
      } catch (err) {
        console.error('Error broadcasting to client:', err);
      }
    }
  });
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // REST API: Get Collaboration Room State
  app.get('/api/collaboration/:activityId/:groupId', (req, res) => {
    const { activityId, groupId } = req.params;
    const room = getOrCreateRoom(activityId, groupId, "course-pc-01", []);
    res.json({ success: true, room });
  });

  // REST API: Lock Section
  app.post('/api/collaboration/lock', (req, res) => {
    const { activityId, groupId, sectionId, user } = req.body;
    if (!activityId || !groupId || !sectionId || !user) {
      return res.status(400).json({ error: 'Parámetros incompletos para bloquear sección.' });
    }

    const room = getOrCreateRoom(activityId, groupId, "course-pc-01", req.body.initialSections || []);
    const section = room.sections.find(s => s.id === sectionId);
    if (!section) {
      return res.status(404).json({ error: 'Sección no encontrada.' });
    }

    // Check if locked by another user
    if (section.lockedBy && section.lockedBy.id !== user.id) {
      const lockAge = Date.now() - new Date(section.lockedBy.lockedAt).getTime();
      // 5 minutes lock expiration
      if (lockAge < 5 * 60 * 1000) {
        return res.status(423).json({
          success: false,
          locked: true,
          lockedBy: section.lockedBy,
          message: `La sección está actualmente en edición por ${section.lockedBy.name}.`
        });
      }
    }

    section.lockedBy = {
      id: user.id,
      name: user.name,
      lockedAt: new Date().toISOString()
    };
    room.lastSyncTimestamp = new Date().toISOString();

    const roomKey = `${activityId}_${groupId}`;
    broadcastToRoom(roomKey, {
      type: 'section_locked',
      sectionId,
      lockedBy: section.lockedBy,
      sections: room.sections
    });

    res.json({ success: true, section, sections: room.sections });
  });

  // REST API: Unlock Section and Save Content
  app.post('/api/collaboration/unlock', (req, res) => {
    const { activityId, groupId, sectionId, content, user } = req.body;
    if (!activityId || !groupId || !sectionId || !user) {
      return res.status(400).json({ error: 'Parámetros incompletos.' });
    }

    const room = getOrCreateRoom(activityId, groupId, "course-pc-01", req.body.initialSections || []);
    const section = room.sections.find(s => s.id === sectionId);
    if (!section) {
      return res.status(404).json({ error: 'Sección no encontrada.' });
    }

    if (content !== undefined) {
      section.content = content;
    }
    section.lockedBy = null;
    section.lastEditedBy = {
      id: user.id,
      name: user.name,
      timestamp: new Date().toISOString()
    };
    room.lastSyncTimestamp = new Date().toISOString();

    const roomKey = `${activityId}_${groupId}`;
    broadcastToRoom(roomKey, {
      type: 'section_unlocked',
      sectionId,
      content: section.content,
      lastEditedBy: section.lastEditedBy,
      sections: room.sections
    });

    res.json({ success: true, section, sections: room.sections });
  });

  // REST API: Submit Iteration
  app.post('/api/collaboration/submit-iteration', (req, res) => {
    const { activityId, groupId, isFinal, comment, fileName, user } = req.body;
    const room = getOrCreateRoom(activityId, groupId, "course-pc-01", req.body.initialSections || []);

    const iterationNum = isFinal ? room.iterationCount : room.iterationCount + 1;
    if (isFinal) {
      room.isFinalSubmitted = true;
      room.finalSubmittedAt = new Date().toISOString();
    } else {
      room.iterationCount += 1;
    }

    room.lastSyncTimestamp = new Date().toISOString();

    const submissionPayload = {
      iterationNumber: iterationNum,
      isFinal,
      comment: comment || (isFinal ? 'Entrega Final Definitiva del Proyecto' : `Borrador Iterativo #${room.iterationCount}`),
      fileName: fileName || `proyecto_grupo_${groupId}_iteracion_${room.iterationCount}.pdf`,
      submittedAt: new Date().toISOString(),
      submittedBy: user,
      sectionsSnapshot: room.sections.map(s => ({ id: s.id, title: s.title, content: s.content }))
    };

    const roomKey = `${activityId}_${groupId}`;
    broadcastToRoom(roomKey, {
      type: 'iteration_submitted',
      submission: submissionPayload,
      roomState: room
    });

    res.json({ success: true, submission: submissionPayload, roomState: room });
  });

  // AI Didactic Content Generation Endpoint with Resilient Fallback & Retries
  app.post('/api/ai/generate-session-content', async (req, res) => {
    try {
      const {
        courseName,
        gradeLevel,
        subject,
        sessionTitle,
        topic,
        weekNumber,
        sessionNumber,
        pedagogicalGoal,
        duaStrategy,
        sourceUrls = [],
        description = '',
        prompt: userPromptText = '',
        pedagogicalStyle = 'Explicativo con Marco Teórico y Caso Práctico Guiado'
      } = req.body;

      const activePrompt = userPromptText || description || `Estructura el marco teórico y un caso práctico de aplicación para ${sessionTitle || topic}`;

      if (!sessionTitle && !topic) {
        return res.status(400).json({ error: 'Título de la sesión o tema es requerido.' });
      }

      const apiKey = process.env.GEMINI_API_KEY;

      if (apiKey) {
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
Actúa como un Diseñador Curricular, Pedagogo Experto y Creador de Experiencias de Aprendizaje Interactivas y Visuales.
Tu misión es generar un recurso didáctico de alta calidad, visual e interactivo para la sesión de clase, extrayendo proactivamente la información desde las URLs (Fuentes y Bibliografía Web) y el Prompt pedagógico del docente.

INFORMACIÓN DE LA SESIÓN:
- Asignatura: ${subject || courseName || 'General'}
- Curso / Grado: ${courseName || ''} - ${gradeLevel || 'Secundaria'}
- Semana / Sesión: Semana ${weekNumber || 1}, Sesión ${sessionNumber || 1}
- Título de la Sesión: ${sessionTitle}
- Tema Central: ${topic}
- Propósito Pedagógico: ${pedagogicalGoal || 'Desarrollar comprensión profunda y aplicación práctica'}
- Pauta DUA: ${duaStrategy || 'Múltiples formas de representación y acción'}

PROMPT E INSTRUCCIONES DEL DOCENTE:
${activePrompt}

FUENTES / ENLACES INGRESADOS POR EL DOCENTE (CRÍTICO: EXTRAE LA INFORMACIÓN DE AQUÍ):
${sourceUrls.length > 0 ? sourceUrls.map((url: string, i: number) => `${i + 1}. ${url}`).join('\n') : 'Sin URLs externas específicas (utilizar fuentes académicas y conocimiento pedagógico especializado).'}

REGLAS DE GENERACIÓN OBLIGATORIAS:
1. Generar ÚNICAMENTE:
   - "Marco Teórico" (Theoretical Framework): Explicación profunda, estructurada con Markdown, visual con llamadas pedagógicas, y un glosario de términos clave nucleares extraídos de las fuentes.
   - "Caso Práctico de Guía o de Aplicación" (Practical Case): Un caso de estudio auténtico y contextualizado con contexto real, reto/desafío planteado, procedimiento de resolución secuencial paso a paso (con checkpoint de reflexión), punto de control interactivo (pregunta de opción múltiple con retroalimentación inmediata) y conclusión/transferencia práctica.
2. NO generar "Ejemplos prácticos genéricos", NO generar "Actividades de extensión" (estas se crean manualmente), NO generar sección de "Metacognición".
3. El contenido debe estructurarse en 2 Pestañas Dinámicas (Tabs) altamente visuales e interactivas:
   - Tab 1: "1. Marco Teórico & Conceptos Nucleares" (Icono: 'BookOpen')
   - Tab 2: "2. Caso Práctico de Guía / Aplicación" (Icono: 'Lightbulb')

Genera el resultado en un JSON estricto con la siguiente estructura:
{
  "summary": "Resumen conciso y motivador de la sesión para el alumno (2 párrafos)",
  "theoreticalFramework": {
    "title": "Título del marco teórico extraído de las fuentes",
    "content": "Texto explicativo detallado y estructurado con markdown (#, ##, viñetas, tablas o listas)",
    "visualCallout": "Destacado visual clave o regla de oro para el estudiante",
    "keyConcepts": [
      { "term": "Término 1", "definition": "Definición pedagógica clara y precisa", "category": "Categoría conceptual" }
    ]
  },
  "practicalCase": {
    "title": "Título del Caso Práctico de Aplicación",
    "context": "Descripción del escenario real, contexto auténtico y actores involucrados",
    "challenge": "Problema o reto específico que se debe resolver",
    "stepByStep": [
      {
        "stepNumber": 1,
        "title": "Paso 1: Diagnóstico o Entrada",
        "description": "Explicación detallada de la acción realizada y análisis técnico/conceptual",
        "checkpointPrompt": "Punto de atención o verificación formativa"
      },
      {
        "stepNumber": 2,
        "title": "Paso 2: Procesamiento o Modelado",
        "description": "Procedimiento paso a paso para resolver la dificultad",
        "checkpointPrompt": "Pregunta guía de reflexión"
      },
      {
        "stepNumber": 3,
        "title": "Paso 3: Validación y Salida",
        "description": "Resultados obtenidos y comprobación de la solución",
        "checkpointPrompt": "Verificación final de impacto"
      }
    ],
    "interactiveCheckpoint": {
      "question": "Pregunta de comprobación interactiva sobre el caso práctico",
      "options": ["Opción A", "Opción B", "Opción C", "Opción D"],
      "correctIndex": 0,
      "explanation": "Justificación formativa completa de por qué es correcta",
      "hint": "Pista orientadora para el alumno"
    },
    "takeaway": "Aprendizaje clave y transferencia a situaciones cotidianas",
    "applicationPrompt": "Pregunta de aplicación práctica inmediata para el estudiante"
  },
  "tabs": [
    {
      "id": "tab-teoria",
      "title": "1. Marco Teórico & Conceptos",
      "icon": "Book",
      "blocks": [
        {
          "type": "theory",
          "title": "Fundamentos Teóricos",
          "content": "...",
          "visualCallout": "..."
        },
        {
          "type": "glossary",
          "terms": [...]
        },
        {
          "type": "sources",
          "items": [...]
        }
      ]
    },
    {
      "id": "tab-caso",
      "title": "2. Caso Práctico de Aplicación",
      "icon": "Lightbulb",
      "blocks": [
        {
          "type": "practical_case",
          "title": "Caso Práctico Guiado",
          "context": "...",
          "challenge": "...",
          "stepByStep": [...],
          "interactiveCheckpoint": {
            "question": "...",
            "options": [...],
            "correctIndex": 0,
            "explanation": "...",
            "hint": "..."
          },
          "takeaway": "..."
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
                teacherPrompt: activePrompt,
                pedagogicalStyle,
                summary: parsedData.summary || `Contenido didáctico generado para la sesión: ${sessionTitle}`,
                tabs: parsedData.tabs || [],
                theoreticalFramework: parsedData.theoreticalFramework || { title: topic, content: '', keyConcepts: [] },
                practicalCase: parsedData.practicalCase || null,
                sourcesConsulted: parsedData.sourcesConsulted || (sourceUrls.length > 0 ? sourceUrls.map((u: string, i: number) => ({ title: `Fuente #${i + 1}`, url: u })) : [])
              }
            });
          } catch (geminiError: any) {
            console.warn(`Attempt with ${modelName} encountered error:`, geminiError?.message || geminiError);
          }
        }
      }

      // High-Quality Intelligent Pedagogical Fallback Generator
      const fallbackDidacticContent = generatePedagogicalFallbackContent({
        courseName,
        gradeLevel,
        subject,
        sessionTitle,
        topic,
        weekNumber,
        sessionNumber,
        pedagogicalGoal,
        duaStrategy,
        sourceUrls,
        description: activePrompt,
        pedagogicalStyle
      });

      return res.json({
        success: true,
        didacticContent: fallbackDidacticContent
      });

    } catch (err: any) {
      console.error('Server error generating session content:', err);
      const fallback = generatePedagogicalFallbackContent(req.body || {});
      return res.json({
        success: true,
        didacticContent: fallback
      });
    }
  });

  // AI Value Proposition Validation Endpoint (EPT - CNEB)
  app.post('/api/ai/validate-value-proposition', async (req, res) => {
    try {
      const { usuario = '', solucion = '', productoDiferencial = '' } = req.body;

      if (!usuario.trim() || !solucion.trim() || !productoDiferencial.trim()) {
        return res.status(400).json({
          error: 'Todos los campos (usuario, necesidad/solución, producto diferencial) son obligatorios.'
        });
      }

      const apiKey = process.env.GEMINI_API_KEY;

      if (apiKey) {
        const modelsToTry = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-flash-latest'];

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

            const systemPrompt = `
Eres un tutor pedagógico experto en Educación para el Trabajo (EPT - CNEB Perú) que evalúa las propuestas de valor de estudiantes de secundaria para la Feria Escolar de Emprendimiento.

Entradas del estudiante:
- Usuario: "${usuario}"
- Necesidad/Solución: "${solucion}"
- Producto Diferencial: "${productoDiferencial}"

Evalúa si la propuesta resuelve una necesidad real y si cuenta con un factor diferenciador claro que la distinga de un negocio común.
Devuelve un JSON estrictamente estructurado:
{
  "esValida": boolean,
  "puntajeCNEB": "AD" | "A" | "B" | "C",
  "criterios": {
    "usuarioIdentificado": boolean,
    "necesidadResuelta": boolean,
    "factorDiferencialClaro": boolean
  },
  "feedbackPedagogico": "Mensaje motivador de 2 o 3 oraciones felicitando los aciertos y señalando mejoras.",
  "sugerenciaInspiradora": "Una versión mejorada y bien redactada de su propuesta de valor para inspirar al estudiante."
}
`;

            const response = await ai.models.generateContent({
              model: modelName,
              contents: systemPrompt,
              config: {
                responseMimeType: 'application/json'
              }
            });

            const responseText = response.text || '';
            if (responseText) {
              const cleaned = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
              const parsed = JSON.parse(cleaned);
              return res.json({
                success: true,
                evaluation: parsed
              });
            }
          } catch (modelErr: any) {
            console.warn(`Validate value proposition error with ${modelName}:`, modelErr?.message || modelErr);
          }
        }
      }

      // Fallback Pedagogical Evaluator
      const hasUser = usuario.trim().length >= 4;
      const hasSolution = solucion.trim().length >= 6;
      const hasDifferentiation = productoDiferencial.trim().length >= 8;
      const isDifferentiated = Boolean(
        productoDiferencial.toLowerCase().includes('qr') ||
        productoDiferencial.toLowerCase().includes('ecológico') ||
        productoDiferencial.toLowerCase().includes('personaliz') ||
        productoDiferencial.toLowerCase().includes('biodegradable') ||
        productoDiferencial.toLowerCase().includes('recicl') ||
        productoDiferencial.toLowerCase().includes('artesanal') ||
        productoDiferencial.toLowerCase().includes('interactiv') ||
        productoDiferencial.toLowerCase().includes('saludable') ||
        productoDiferencial.toLowerCase().includes('rápido') ||
        productoDiferencial.toLowerCase().includes('natural') ||
        productoDiferencial.length > 20
      );

      const isValid = hasUser && hasSolution && hasDifferentiation && isDifferentiated;
      const score = isValid ? (isDifferentiated && hasSolution ? 'AD' : 'A') : (hasUser && hasSolution ? 'B' : 'C');

      const fallbackEvaluation = {
        esValida: isValid,
        puntajeCNEB: score,
        criterios: {
          usuarioIdentificado: hasUser,
          necesidadResuelta: hasSolution,
          factorDiferencialClaro: isDifferentiated
        },
        feedbackPedagogico: isValid
          ? `¡Excelente formulación de tu propuesta de valor! Has identificado claramente a ${usuario} y resuelves una necesidad auténtica con un elemento diferenciador innovador para la feria.`
          : `Has dado un buen primer paso delimitando a ${usuario}. Para lograr un nivel sobresaliente (AD), procura detallar con mayor precisión qué hace a tu producto único frente a los demás puestos de la feria escolar.`,
        sugerenciaInspiradora: `Ayudamos a ${usuario || 'los visitantes de la feria'} a ${solucion || 'disfrutar de opciones saludables y sostenibles'} mediante ${productoDiferencial || 'productos ecológicos elaborados con insumos locales y empaques biodegradables con código QR informativo'}.`
      };

      return res.json({
        success: true,
        evaluation: fallbackEvaluation
      });

    } catch (err: any) {
      console.error('Error validating value proposition:', err);
      return res.status(500).json({
        error: 'No se pudo completar la validación en este momento.'
      });
    }
  });

  // AI Team Charter & Backward Planning Validation Endpoint (EPT - CNEB Sesión 2)
  app.post('/api/ai/validate-team-charter', async (req, res) => {
    try {
      const {
        teamName = '',
        valueProp = '',
        members = [],
        backwardGoals = {},
        goldenRule = ''
      } = req.body;

      // Anti-gibberish / sanitization helpers
      const isValidPersonNameServer = (name: any): boolean => {
        if (!name || typeof name !== 'string') return false;
        const trimmed = name.trim();
        if (trimmed.length < 6) return false;
        const words = trimmed.split(/\s+/).filter(w => w.length >= 2);
        if (words.length < 2) return false;

        const vowelsCount = (trimmed.match(/[aeiouáéíóúü]/gi) || []).length;
        const lettersCount = (trimmed.match(/[a-záéíóúüñ]/gi) || []).length;
        if (lettersCount > 0 && vowelsCount / lettersCount < 0.22) return false;
        if (/(.)\1{3,}/i.test(trimmed)) return false;

        // Gibberish keyboard mashing check (e.g. sdf, zhm, dhm, ghny)
        const commonConsonantClusters = /([bcdfghjklmnpqrstvwxyz]{5,})/i;
        if (commonConsonantClusters.test(trimmed.replace(/\s+/g, ''))) return false;

        return true;
      };

      const isValidGoldenRuleServer = (rule: any): boolean => {
        if (!rule || typeof rule !== 'string') return false;
        const trimmed = rule.trim();
        if (trimmed.length < 20) return false;
        const words = trimmed.split(/\s+/).filter(w => w.length >= 2);
        if (words.length < 4) return false;

        const vowelsCount = (trimmed.match(/[aeiouáéíóúü]/gi) || []).length;
        const lettersCount = (trimmed.match(/[a-záéíóúüñ]/gi) || []).length;
        if (lettersCount > 0 && vowelsCount / lettersCount < 0.22) return false;
        if (/(.)\1{3,}/i.test(trimmed)) return false;

        return true;
      };

      // Strict validation of the 6 team members and golden rule
      const validMembersCount = Array.isArray(members)
        ? members.filter((m: any) => m && isValidPersonNameServer(m.name)).length
        : 0;
      const isSixRolesValid = validMembersCount === 6 && members.length === 6;
      const isGoldenRuleValid = isValidGoldenRuleServer(goldenRule);
      const isGibberishOrIncomplete = !isSixRolesValid || !isGoldenRuleValid;

      // REGLA DE CALIFICACIÓN ESTRICTA:
      // Si se detecta texto basura o datos incompletos en los integrantes o en la regla de oro:
      // DEBE responder forzosamente con puntajeCNEB: "C" (Nivel Inicio) y esValida: false.
      if (isGibberishOrIncomplete) {
        return res.json({
          success: true,
          evaluation: {
            esValida: false,
            puntajeCNEB: 'C',
            checklist: {
              propuestaIntegrada: Boolean(valueProp && valueProp.length > 10),
              rolesEquilibrados: false,
              metasInversasCompletas: Object.values(backwardGoals || {}).filter((g: any) => typeof g === 'string' && g.trim().length > 8).length >= 5,
              reglaConvivenciaSolida: false
            },
            feedbackMentor: '⚠️ Atención equipo: Se detectaron nombres incompletos o texto sin sentido en la asignación de roles y en la Regla de Oro. Deben ingresar los nombres y apellidos reales de sus 6 integrantes y redactar un compromiso de convivencia claro para que el Acta sea válida.',
            consejoOperativo: 'Cada integrante debe figurar con su Nombre y Apellido real (mínimo 2 palabras) y la Regla de Oro debe ser una norma de convivencia con al menos 4 palabras con sentido.',
            selloCalidad: 'Estructura en Proceso de Consolidación (Requiere Corrección de Datos)'
          }
        });
      }

      const goalsList = Object.values(backwardGoals || {}).filter((g: any) => typeof g === 'string' && g.trim().length > 8);
      const allGoalsFilled = goalsList.length >= 5;

      const apiKey = process.env.GEMINI_API_KEY;

      if (apiKey) {
        const modelsToTry = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-flash-latest'];

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
Eres un tutor y mentor pedagógico experto en Educación para el Trabajo (EPT - CNEB Perú) evaluando el Acta de Organización Empresarial y Planificación Inversa de un equipo de 6 estudiantes de secundaria para la Feria de Emprendimiento escolar del 21 de noviembre.

Datos del equipo:
- Nombre del Equipo: "${teamName}"
- Propuesta de Valor heredada de Sesión 1: "${valueProp}"
- Asignación de Roles de los 6 integrantes: ${JSON.stringify(members)}
- Metas Inversas (Backward Planning desde Semana 7 hasta Semana 3): ${JSON.stringify(backwardGoals)}
- Regla de Oro de Convivencia y Rendimiento: "${goldenRule}"

REGLAS DE EVALUACIÓN ESTRICTA:
1. Revisa rigurosamente que los nombres no sean texto basura o teclas al azar. Si detectas texto sin sentido, califica inmediatamente con "C".
2. Cohesión de roles para los 6 integrantes (1 Coordinador/Gerente, 2 Producción, 1 Marketing, 2 Finanzas).
3. Claridad, viabilidad y secuencia inversa de las 5 metas (Semana 7 hacia Semana 3).
4. Efectividad de la regla de convivencia (compromiso real para prevenir conflictos).

Responde ÚNICAMENTE en JSON con esta estructura exacta:
{
  "esValida": boolean,
  "puntajeCNEB": "AD" | "A" | "B" | "C",
  "checklist": {
    "propuestaIntegrada": boolean,
    "rolesEquilibrados": boolean,
    "metasInversasCompletas": boolean,
    "reglaConvivenciaSolida": boolean
  },
  "feedbackMentor": "Mensaje motivador y formativo de 3 oraciones felicitando la organización del equipo y dando 1 consejo clave para la feria.",
  "consejoOperativo": "Un consejo práctico de gestión de tiempo y stand para el día de la feria escolar.",
  "selloCalidad": "Equipo de Alto Rendimiento Listo para Producción"
}
`;

            const response = await ai.models.generateContent({
              model: modelName,
              contents: prompt,
              config: {
                responseMimeType: 'application/json'
              }
            });

            const responseText = response.text || '';
            if (responseText) {
              const cleaned = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
              const parsed = JSON.parse(cleaned);
              return res.json({
                success: true,
                evaluation: parsed
              });
            }
          } catch (modelErr: any) {
            console.warn(`Validate team charter error with ${modelName}:`, modelErr?.message || modelErr);
          }
        }
      }

      // Fallback evaluation
      const isValid = Boolean(
        teamName.trim().length >= 3 &&
        isSixRolesValid &&
        allGoalsFilled &&
        isGoldenRuleValid
      );

      const score = isValid ? (goalsList.length === 5 && goldenRule.length > 25 ? 'AD' : 'A') : (isSixRolesValid || goalsList.length >= 3 ? 'B' : 'C');

      const fallbackEvaluation = {
        esValida: isValid,
        puntajeCNEB: score,
        checklist: {
          propuestaIntegrada: Boolean(valueProp && valueProp.length > 10),
          rolesEquilibrados: isSixRolesValid,
          metasInversasCompletas: allGoalsFilled,
          reglaConvivenciaSolida: isGoldenRuleValid
        },
        feedbackMentor: isValid
          ? `¡Felicitaciones equipo "${teamName || 'Emprendedor'}"! Han consolidado una estructura operativa clara para 6 integrantes y una ruta de diseño inverso impecable desde la Semana 7 hasta la Semana 3. Están listos para iniciar prototipado.`
          : 'Tienen una buena base, pero asegúrense de completar los 6 integrantes con sus roles y redactar metas medibles para cada una de las 5 semanas inversas antes de pasar a la producción.',
        consejoOperativo: 'Nombrar un encargado de control de calidad por turno en el stand garantizará que nunca falte stock ni cambio para las ventas.',
        selloCalidad: isValid ? 'Equipo de Alto Rendimiento Listo para Producción' : 'Estructura en Proceso de Consolidación'
      };

      return res.json({
        success: true,
        evaluation: fallbackEvaluation
      });

    } catch (err: any) {
      console.error('Error validating team charter:', err);
      return res.status(500).json({
        error: 'No se pudo completar la validación del acta de equipo.'
      });
    }
  });

  // AI Backward Planning Validation Endpoint (EPT - CNEB Sesión 2 Bloque 3)
  app.post('/api/ai/validate-backward-planning', async (req, res) => {
    try {
      const { metas = {}, isOnlyPresetSelected = false } = req.body;

      // Presets catalog to detect verbatim copies
      const PRESET_SUGGESTIONS = [
        'Vender 120 unidades a S/ 2.50 recuperando 100% de la inversión y logrando S/ 80 de ganancia neta.',
        'Atender a más de 80 clientes en el stand sin colas mayores a 2 minutos y con empaque 100% ecológico.',
        'Agotar todo el stock antes de las 13:00 hrs y presentar encuesta de satisfacción con 90% de aprobación.',
        'Tener listo el cartel principal, mantel del stand, código QR de cobro impreso y pitch de 60 segundos ensayado por todos.',
        'Realizar simulacro de atención rápida con cambio para S/ 10 y S/ 20 sin confusiones de caja.',
        'Montaje del stand en miniatura con roles de rotación de turnos asignados para los 6 integrantes.',
        'Calcular costo unitario exacto (S/ 1.40), fijar precio de venta (S/ 2.50) y punto de equilibrio en 68 unidades.',
        'Definir aporte de capital por integrante (S/ 15 cada uno) y archivar tabla de costos fijos y variables.',
        'Diseñar planilla de control de caja chica y lista de precios visible para los padres y visitantes.',
        'Diseñar logotipo oficial, etiquetas con tabla nutricional/ingredientes y comprar 150 empaques biodegradables.',
        'Publicar volante digital en el grupo escolar y colocar afiche promocional en el periódico mural.',
        'Tener sellos o stickers ecológicos impresos y stickers distintivos para el uniforme del equipo.',
        'Elaborar el primer lote de prueba de 10 unidades, realizar degustación con 15 compañeros y ajustar sabor.',
        'Validar lista definitiva de insumos de bajo costo con el docente de EPT y definir medidas higiénicas.',
        'Completar ficha técnica de elaboración con tiempo de preparación menor a 30 minutos por lote.'
      ];

      const normalize = (t: string) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

      const normalizedPresets = PRESET_SUGGESTIONS.map(normalize);

      const m7 = (metas[7] || metas.sem7 || '').trim();
      const m6 = (metas[6] || metas.sem6 || '').trim();
      const m5 = (metas[5] || metas.sem5 || '').trim();
      const m4 = (metas[4] || metas.sem4 || '').trim();
      const m3 = (metas[3] || metas.sem3 || '').trim();

      const goalsArray = [m7, m6, m5, m4, m3].filter(g => g.length > 0);

      // Check if all filled goals are exact copies of presets
      let exactMatchesCount = 0;
      for (const goal of goalsArray) {
        const norm = normalize(goal);
        if (normalizedPresets.includes(norm)) {
          exactMatchesCount++;
        }
      }

      const isCopied = isOnlyPresetSelected || (goalsArray.length >= 3 && exactMatchesCount >= Math.min(3, goalsArray.length));

      // 1. REGLA ESTRICTA DE SUGERENCIAS COPIADAS
      if (isCopied) {
        return res.json({
          success: true,
          evaluation: {
            esValido: false,
            esCopiaSugerencia: true,
            puntajeCNEB: 'B',
            feedbackPedagogico: '⚠️ Las ideas sugeridas son solo un ejemplo para inspirarte. Cada equipo debe personalizar y redactar sus metas con sus propios números, su producto específico y los insumos reales que traerán. ¡Edita los textos con el criterio de tu equipo antes de pasarlo a tu cuaderno!',
            recomendacion: 'Reemplaza las cantidades (ej. unidades a vender, precio, ingredientes o empaque) por los datos concretos del proyecto de tu salón.'
          }
        });
      }

      // Check empty or very short
      if (goalsArray.length < 3) {
        return res.json({
          success: true,
          evaluation: {
            esValido: false,
            esCopiaSugerencia: false,
            puntajeCNEB: 'C',
            feedbackPedagogico: 'Tu ruta inversa aún está incompleta. Necesitas redactar al menos 3 de las 5 semanas con metas medibles antes de recibir la validación formativa.',
            recomendacion: 'Empieza definiendo la meta final de la Semana 7 (Feria) y retrocede semana a semana.'
          }
        });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        const modelsToTry = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-flash-latest'];

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
Eres un tutor pedagógico experto en Educación para el Trabajo (EPT - CNEB Perú) evaluando el Simulador de Diseño Inverso (Backward Planning) de una pareja de estudiantes de secundaria para la Feria Escolar del 21 de noviembre.

Metas redactadas por los estudiantes (desde la Semana 7 hacia la Semana 3):
- Semana 7 (Feria): "${m7}"
- Semana 6 (Stand / Pitch): "${m6}"
- Semana 5 (Costos y Precios): "${m5}"
- Semana 4 (Empaque y Marca): "${m4}"
- Semana 3 (Prototipo e Insumos): "${m3}"

Criterios de Evaluación CNEB (Capacidad: Trabaja cooperativamente para lograr objetivos y metas):
1. ¿La Semana 7 tiene meta cuantificable de venta (unidades/dinero)?
2. ¿La Semana 6 contempla pitch o stand?
3. ¿La Semana 5 incluye estimación de costos/precios?
4. ¿La Semana 4 incluye empaque ecológico/marca?
5. ¿La Semana 3 detalla materiales e insumos reales para el prototipo?

Verifica si es un texto auténtico con datos propios o copia literal de presets.
Devuelve ÚNICAMENTE un JSON estructurado así:
{
  "esValido": boolean,
  "esCopiaSugerencia": false,
  "puntajeCNEB": "AD" | "A" | "B" | "C",
  "feedbackPedagogico": "Felicitación formativa de 2 oraciones reconociendo la precisión de sus números y la secuencia inversa.",
  "recomendacion": "Un consejo breve para el registro en la Bitácora del emprendedor."
}
`;

            const response = await ai.models.generateContent({
              model: modelName,
              contents: prompt,
              config: {
                responseMimeType: 'application/json'
              }
            });

            const responseText = response.text || '';
            if (responseText) {
              const cleaned = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
              const parsed = JSON.parse(cleaned);
              return res.json({
                success: true,
                evaluation: parsed
              });
            }
          } catch (modelErr: any) {
            console.warn(`Validate backward planning error with ${modelName}:`, modelErr?.message || modelErr);
          }
        }
      }

      // Fallback auténtico
      const hasNumbers = /\d+/.test(m7) || /\d+/.test(m5) || /\d+/.test(m3);
      const isComplete = goalsArray.length === 5;
      const score = isComplete && hasNumbers ? 'AD' : goalsArray.length >= 4 ? 'A' : 'B';

      return res.json({
        success: true,
        evaluation: {
          esValido: score === 'AD' || score === 'A',
          esCopiaSugerencia: false,
          puntajeCNEB: score,
          feedbackPedagogico: `¡Excelente formulación de su ruta inversa! Han delimitado metas claras desde el sábado 21 de noviembre en la feria escolar hasta el prototipo de la próxima semana, evidenciando cuantificación y previsión operativa.`,
          recomendacion: 'Ahora anoten estas metas en su Cuaderno (Bitácora) antes de reunirse los 6 en el Bloque 4.'
        }
      });

    } catch (err: any) {
      console.error('Error validating backward planning:', err);
      return res.status(500).json({
        error: 'No se pudo completar la evaluación del diseño inverso.'
      });
    }
  });

  // WebSocket Server for Real-Time Group Collaboration
  const wss = new WebSocketServer({ server, path: '/ws/collaboration' });

  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (data: string) => {
      try {
        const message = JSON.parse(data.toString());
        const { type, roomId, activityId, groupId, user, sectionId, content, chatText, initialSections } = message;

        if (type === 'join') {
          const roomKey = roomId || `${activityId}_${groupId}`;
          if (!roomSockets.has(roomKey)) {
            roomSockets.set(roomKey, new Set());
          }
          roomSockets.get(roomKey)!.add(ws);
          socketUserMap.set(ws, { roomId: roomKey, userId: user?.id || 'guest', userName: user?.name || 'Compañero' });

          const room = getOrCreateRoom(activityId, groupId, "course-pc-01", message.initialSections);
          
          // Update active users
          if (user?.id) {
            const existingIdx = room.activeUsers.findIndex(u => u.id === user.id);
            const userEntry = {
              id: user.id,
              name: user.name,
              avatar: user.avatar,
              activeSectionId: sectionId,
              lastPing: new Date().toISOString()
            };
            if (existingIdx >= 0) {
              room.activeUsers[existingIdx] = userEntry;
            } else {
              room.activeUsers.push(userEntry);
            }
          }

          // Send current state to newly connected client
          ws.send(JSON.stringify({
            type: 'init_state',
            room
          }));

          // Broadcast user joined to other members
          broadcastToRoom(roomKey, {
            type: 'user_joined',
            user,
            activeUsers: room.activeUsers
          }, ws);
        }

        else if (type === 'lock_section') {
          const roomKey = roomId || `${activityId}_${groupId}`;
          const room = getOrCreateRoom(activityId, groupId, "course-pc-01", message.initialSections);
          const section = room.sections.find(s => s.id === sectionId);

          if (section) {
            if (section.lockedBy && section.lockedBy.id !== user?.id) {
              ws.send(JSON.stringify({
                type: 'lock_rejected',
                sectionId,
                lockedBy: section.lockedBy,
                message: `La sección está siendo editada por ${section.lockedBy.name}`
              }));
            } else {
              section.lockedBy = {
                id: user.id,
                name: user.name,
                lockedAt: new Date().toISOString()
              };
              room.lastSyncTimestamp = new Date().toISOString();

              broadcastToRoom(roomKey, {
                type: 'section_locked',
                sectionId,
                lockedBy: section.lockedBy,
                sections: room.sections
              });
            }
          }
        }

        else if (type === 'unlock_section') {
          const roomKey = roomId || `${activityId}_${groupId}`;
          const room = getOrCreateRoom(activityId, groupId, "course-pc-01", message.initialSections);
          const section = room.sections.find(s => s.id === sectionId);

          if (section) {
            if (content !== undefined) {
              section.content = content;
            }
            section.lockedBy = null;
            section.lastEditedBy = {
              id: user.id,
              name: user.name,
              timestamp: new Date().toISOString()
            };
            room.lastSyncTimestamp = new Date().toISOString();

            broadcastToRoom(roomKey, {
              type: 'section_unlocked',
              sectionId,
              content: section.content,
              lastEditedBy: section.lastEditedBy,
              sections: room.sections
            });
          }
        }

        else if (type === 'update_section') {
          const roomKey = roomId || `${activityId}_${groupId}`;
          const room = getOrCreateRoom(activityId, groupId, "course-pc-01", message.initialSections);
          const section = room.sections.find(s => s.id === sectionId);

          if (section) {
            section.content = content;
            section.lastEditedBy = {
              id: user.id,
              name: user.name,
              timestamp: new Date().toISOString()
            };
            room.lastSyncTimestamp = new Date().toISOString();

            broadcastToRoom(roomKey, {
              type: 'section_updated',
              sectionId,
              content: section.content,
              lastEditedBy: section.lastEditedBy,
              isRemote: true
            }, ws);
          }
        }

        else if (type === 'send_chat') {
          const roomKey = roomId || `${activityId}_${groupId}`;
          const room = getOrCreateRoom(activityId, groupId, "course-pc-01", message.initialSections);

          const chatMessage: CollaborationChatMessage = {
            id: `chat-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            senderId: user?.id || 'std',
            senderName: user?.name || 'Compañero',
            text: chatText || '',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };

          room.chatMessages.push(chatMessage);
          if (room.chatMessages.length > 100) {
            room.chatMessages.shift();
          }

          broadcastToRoom(roomKey, {
            type: 'new_chat_message',
            message: chatMessage
          });
        }

        else if (type === 'ping') {
          const roomKey = roomId || `${activityId}_${groupId}`;
          const room = getOrCreateRoom(activityId, groupId, "course-pc-01", message.initialSections);
          if (user?.id) {
            const u = room.activeUsers.find(act => act.id === user.id);
            if (u) {
              u.lastPing = new Date().toISOString();
              if (sectionId !== undefined) {
                u.activeSectionId = sectionId;
              }
            }
          }
        }

      } catch (e) {
        console.error('Error processing websocket message:', e);
      }
    });

    ws.on('close', () => {
      const userInfo = socketUserMap.get(ws);
      if (userInfo) {
        const { roomId, userId } = userInfo;
        const sockets = roomSockets.get(roomId);
        if (sockets) {
          sockets.delete(ws);
          if (sockets.size === 0) {
            roomSockets.delete(roomId);
          }
        }
        socketUserMap.delete(ws);

        // Remove active user & release any locks held by this user
        const room = collaborationRooms.get(roomId);
        if (room) {
          room.activeUsers = room.activeUsers.filter(u => u.id !== userId);
          let locksChanged = false;
          room.sections.forEach(s => {
            if (s.lockedBy && s.lockedBy.id === userId) {
              s.lockedBy = null;
              locksChanged = true;
            }
          });

          broadcastToRoom(roomId, {
            type: 'user_left',
            userId,
            activeUsers: room.activeUsers,
            sections: locksChanged ? room.sections : undefined
          });
        }
      }
    });
  });

  // Vite middleware for development vs static build for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server with WebSockets running at http://0.0.0.0:${PORT}`);
  });
}

function generatePedagogicalFallbackContent(params: any) {
  const {
    courseName = 'Pensamiento Computacional',
    gradeLevel = '3° de Secundaria',
    sessionTitle = 'Sesión Didáctica',
    topic = 'Algoritmos y Lógica de Programación',
    pedagogicalGoal = 'Comprender conceptos nucleares y aplicar en resolución de retos',
    duaStrategy = 'Representación multimodal visual y práctica',
    sourceUrls = [],
    description = ''
  } = params;

  return {
    generatedAt: new Date().toISOString(),
    sourceUrls,
    teacherPrompt: description || 'Generación pedagógica asistida estructurada',
    pedagogicalStyle: 'Explicativo con Ejemplos Cotidianos y Retos Prácticos',
    summary: `Esta sesión profundiza en **${topic}**, diseñada para estudiantes de ${gradeLevel}. Mediante el análisis de fuentes seleccionadas y analogías de la vida real, los alumnos exploran los fundamentos teóricos, resuelven casos prácticos y consolidan su aprendizaje a través de dinámicas activas.`,
    theoreticalFramework: {
      title: `Marco Conceptual: Fundamentos de ${topic}`,
      content: `### 1. Introducción y Contextualización
El estudio de **${topic}** constituye una pieza angular en ${courseName}. Comprender cómo descomponer problemas complejos en componentes elementales permite desarrollar un pensamiento analítico y estructurado.

### 2. Principios Nucleares
- **Descomposición Sistemática:** Dividir la problemática en sub-problemas abordables de manera incremental.
- **Reconocimiento de Patrones:** Identificar regularidades y estructuras repetitivas para formular soluciones reutilizables.
- **Abstracción Didáctica:** Filtrar detalles irrelevantes para concentrarse en la lógica medular y los flujos de decisión.
- **Verificación y Depuración:** Comprobar la validez de las soluciones frente a diferentes casos de prueba y condiciones de borde.

### 3. Estrategia DUA Integrada
${duaStrategy || 'Se ofrece andamiaje visual mediante esquemas de flujo, descripciones verbales y ejemplos en código simplificado.'}`,
      keyConcepts: [
        {
          term: 'Abstracción',
          definition: 'Proceso mental de aislar las características esenciales de un objeto o problema descartando los detalles accesorios.',
          category: 'Principio Lógico'
        },
        {
          term: 'Algoritmo',
          definition: 'Secuencia ordenada, finita y no ambigua de pasos e instrucciones para resolver un problema o completar una tarea.',
          category: 'Estructura'
        },
        {
          term: 'Condición de Borde',
          definition: 'Situación extrema o límite en la que un sistema o función debe comportarse de manera controlada y predecible.',
          category: 'Validación'
        },
        {
          term: 'Depuración (Debugging)',
          definition: 'Metodología sistemática para identificar, aislar y corregir fallos o errores de lógica en una solución.',
          category: 'Práctica Técnica'
        }
      ],
      visualCallout: `Regla de Oro: La descomposición lógica y la estructuración paso a paso permiten resolver cualquier problema complejo sin errores.`
    },
    practicalCase: {
      title: `Caso Práctico Guiado: Aplicación Real en ${topic}`,
      context: `En una comunidad escolar se implementa un sistema digital para optimizar la gestión y distribución de recursos en tiempo real, garantizando accesibilidad y equidad para todos los estudiantes.`,
      challenge: `¿Cómo estructurar un flujo secuencial que valide entradas, gestione prioridades y entregue retroalimentación inmediata minimizando los tiempos de espera?`,
      stepByStep: [
        {
          stepNumber: 1,
          title: `Paso 1: Diagnóstico de Necesidades & Captura de Datos`,
          description: `Se analizan los requerimientos de los usuarios y se filtran las variables críticas para alimentar el modelo de decisión.`,
          checkpointPrompt: `¿Qué variables son imprescindibles y cuáles pueden descartarse como detalles secundarios?`
        },
        {
          stepNumber: 2,
          title: `Paso 2: Procesamiento Lógico & Flujo de Decisiones`,
          description: `Se aplica el algoritmo de clasificación y asignación por prioridades, validando condiciones de borde para evitar saturaciones.`,
          checkpointPrompt: `¿Cómo responde el algoritmo ante valores extremos o solicitudes simultáneas?`
        },
        {
          stepNumber: 3,
          title: `Paso 3: Validación Empírica & Comunicación Visual`,
          description: `Se despliegan los resultados en un panel accesible con indicadores de estado y confirmación interactiva para el usuario.`,
          checkpointPrompt: `Verificar que la respuesta llegue en menos de 100ms y cumpla con el estándar de accesibilidad.`
        }
      ],
      interactiveCheckpoint: {
        question: `Al implementar la solución para este caso, ¿cuál es el primer paso metodológico antes de programar o ejecutar?`,
        options: [
          `A) Descomponer el problema e identificar las variables críticas de entrada`,
          `B) Publicar el producto final directamente sin pruebas previas`,
          `C) Ignorar las condiciones límite para acelerar la entrega`,
          `D) Reescribir todo el sistema desde cero sin consultar las fuentes`
        ],
        correctIndex: 0,
        explanation: `El diagnóstico y descomposición previa es el pilar fundamental que previene reprocesos y asegura una solución robusta.`,
        hint: `Recuerda qué fase asegura que comprendas plenamente el problema antes de proponer código o soluciones.`
      },
      takeaway: `La aplicación sistemática del pensamiento estructurado permite transformar desafíos complejos en soluciones accesibles, escalables y comprobables.`,
      applicationPrompt: `¿Cómo aplicarías este mismo procedimiento secuencial para resolver un problema cotidiano en tu salón de clases?`
    },
    sourcesConsulted: sourceUrls.length > 0
      ? sourceUrls.map((url: string, index: number) => ({
          title: `Fuente de Referencia Docente #${index + 1}`,
          url,
          description: 'Documentación y bibliografía recomendada para la profundización temática.'
        }))
      : [
          {
            title: 'Repositorio Curricular y Fuentes Especializadas',
            url: 'https://code.org/curriculum',
            description: 'Guías didácticas, estándares de aprendizaje y recursos interactivos.'
          },
          {
            title: 'Portal DUA - Center for Applied Special Technology (CAST)',
            url: 'https://www.cast.org/impact/universal-design-for-learning-udl',
            description: 'Pautas para el diseño de experiencias educativas accesibles e inclusivas.'
          }
        ],
    tabs: [
      {
        id: 'tab-teoria',
        title: '1. Marco Teórico & Conceptos',
        icon: 'Book',
        blocks: [
          {
            type: 'theory',
            title: `Marco Conceptual: Fundamentos de ${topic}`,
            content: `El estudio de **${topic}** constituye una pieza angular en el desarrollo de habilidades analíticas y estructuradas.\n\n### Principios Nucleares\n- **Descomposición Sistemática:** Dividir la problemática en sub-problemas abordables de manera incremental.\n- **Reconocimiento de Patrones:** Identificar regularidades para formular soluciones reutilizables.\n- **Abstracción Didáctica:** Concentrarse en la lógica medular y los flujos de decisión.\n- **Verificación y Calidad:** Comprobar la validez frente a diferentes casos de prueba.`,
            visualCallout: `Regla de Oro: La descomposición lógica y la estructuración paso a paso permiten resolver cualquier problema complejo sin errores.`
          },
          {
            type: 'glossary',
            terms: [
              {
                term: 'Abstracción Didáctica',
                definition: 'Aislar las características esenciales de una situación o problema descartando detalles secundarios.',
                category: 'Principio Lógico'
              },
              {
                term: 'Estructura Sistemática',
                definition: 'Secuencia ordenada, finita y no ambigua de pasos para alcanzar un objetivo pedagógico o técnico.',
                category: 'Estructura'
              },
              {
                term: 'Validación Formativa',
                definition: 'Proceso continuo de comprobación y ajuste para asegurar que la solución cumpla los requerimientos.',
                category: 'Validación'
              },
              {
                term: 'Optimización de Procesos',
                definition: 'Mejora continua del rendimiento, claridad y eficiencia en la ejecución de tareas.',
                category: 'Práctica'
              }
            ]
          },
          {
            type: 'sources',
            items: sourceUrls.length > 0
              ? sourceUrls.map((u: string, i: number) => ({ title: `Fuente consultada #${i + 1}`, url: u }))
              : [
                  { title: 'Bibliografía Curricular Oficial', url: 'https://minedu.gob.pe' },
                  { title: 'Portal DUA - CAST', url: 'https://cast.org' }
                ]
          }
        ]
      },
      {
        id: 'tab-caso',
        title: '2. Caso Práctico de Aplicación',
        icon: 'Lightbulb',
        blocks: [
          {
            type: 'practical_case',
            title: `Caso Práctico Guiado: ${topic}`,
            context: `En una comunidad escolar se implementa un sistema digital para optimizar la gestión y distribución de recursos en tiempo real.`,
            challenge: `¿Cómo estructurar un flujo secuencial que valide entradas, gestione prioridades y entregue retroalimentación inmediata?`,
            stepByStep: [
              {
                stepNumber: 1,
                title: `Paso 1: Diagnóstico de Necesidades & Captura de Datos`,
                description: `Se analizan los requerimientos de los usuarios y se filtran las variables críticas para alimentar el modelo de decisión.`,
                checkpointPrompt: `¿Qué variables son imprescindibles y cuáles pueden descartarse?`
              },
              {
                stepNumber: 2,
                title: `Paso 2: Procesamiento Lógico & Flujo de Decisiones`,
                description: `Se aplica el algoritmo de clasificación y asignación por prioridades, validando condiciones de borde.`,
                checkpointPrompt: `¿Cómo responde el algoritmo ante solicitudes simultáneas?`
              },
              {
                stepNumber: 3,
                title: `Paso 3: Validación Empírica & Comunicación Visual`,
                description: `Se despliegan los resultados en un panel accesible con indicadores de estado y confirmación interactiva.`,
                checkpointPrompt: `Verificar que la respuesta cumpla con el estándar de accesibilidad.`
              }
            ],
            interactiveCheckpoint: {
              question: `Al implementar la solución para este caso, ¿cuál es el primer paso metodológico antes de ejecutar?`,
              options: [
                `A) Descomponer el problema e identificar las variables críticas de entrada`,
                `B) Publicar el producto final directamente sin pruebas previas`,
                `C) Ignorar las condiciones límite para acelerar la entrega`,
                `D) Reescribir todo el sistema desde cero sin consultar las fuentes`
              ],
              correctIndex: 0,
              explanation: `El diagnóstico y descomposición previa es el pilar fundamental que previene reprocesos y asegura una solución robusta.`,
              hint: `Recuerda qué fase asegura que comprendas plenamente el problema antes de proponer código o soluciones.`
            },
            takeaway: `La aplicación sistemática del pensamiento estructurado permite transformar desafíos complejos en soluciones accesibles, escalables y comprobables.`
          }
        ]
      }
    ],
    rawMarkdown: `### Material Didáctico de la Sesión: ${sessionTitle}\n**Tema:** ${topic}\n\n${description}`
  };
}

startServer();
