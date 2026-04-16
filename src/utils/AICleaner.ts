const OPENROUTER_API_KEY = "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";

// Modelos gratuitos con fallback — se prueban en orden
const MODELS = [
  "google/gemma-4-31b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-3-27b-it:free",
  "openrouter/free",
];

// ═══════════════════════════════════════════
// Tipos
// ═══════════════════════════════════════════

export interface CleanResult {
  cleanText: string;
  originalText: string;
  detectedTitle: string;
  removedFragments: string[];
  corrections: { mal: string; bien: string }[];
}

// ═══════════════════════════════════════════
// 1. LIMPIEZA REGEX (determinística, sin IA)
// ═══════════════════════════════════════════

/**
 * Aplica reglas regex genéricas para eliminar ruido estructural.
 * NUNCA resume, NUNCA reescribe, NUNCA elimina contenido narrativo.
 */
function cleanTextWithRegex(text: string): { cleanText: string; removedFragments: string[] } {
  const removed: string[] = [];

  const lines = text.split('\n');
  const cleanLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Regla 1: URLs completas
    if (/^https?:\/\/\S+$/i.test(trimmed)) {
      removed.push(`🔗 URL: ${trimmed}`);
      continue;
    }

    // Regla 2: Rutas web sueltas (líneas que son solo una ruta)
    if (/^\/[a-z]{2}\/[\w\/-]+\.?\s*$/.test(trimmed)) {
      removed.push(`🔗 Ruta web: ${trimmed}`);
      continue;
    }

    // Regla 3: Líneas de Pingback / cookies / copyright suelto
    if (/^(Pingback|pingback|Cookie|cookie|©)\b/i.test(trimmed)) {
      removed.push(`🧹 Metadato web: ${trimmed}`);
      continue;
    }

    // Regla 4: Números de página tipo "N/N" (ej: 9/9, 1/15)
    if (/^\d{1,3}\s*\/\s*\d{1,3}$/.test(trimmed)) {
      removed.push(`📄 Paginación: ${trimmed}`);
      continue;
    }

    // Regla 5: Número de página suelto (línea con solo 1-3 dígitos)
    if (/^\d{1,3}$/.test(trimmed) && trimmed.length <= 3) {
      removed.push(`📄 Número de página: ${trimmed}`);
      continue;
    }

    // Regla 6: Indicador "Página N"
    if (/^Página\s+\d+/i.test(trimmed)) {
      removed.push(`📄 Indicador: ${trimmed}`);
      continue;
    }

    // Regla 7: Metadatos web tipo "Nombre Mes DD, YYYY" (fecha de publicación)
    // Ejemplo: "Carolina May 14, 2022" o "Juan Pérez Enero 5, 2023"
    if (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*\s+(January|February|March|April|May|June|July|August|September|October|November|December|Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Octubre|Noviembre|Diciembre|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}\.?\s*$/i.test(trimmed)) {
      removed.push(`📅 Metadato fecha: ${trimmed}`);
      continue;
    }

    // Limpiar URLs inline dentro de líneas de contenido (no eliminar la línea entera)
    let cleanedLine = line;
    const urlMatches = cleanedLine.match(/https?:\/\/\S+/gi);
    if (urlMatches) {
      for (const url of urlMatches) {
        removed.push(`🔗 URL inline: ${url}`);
        cleanedLine = cleanedLine.replace(url, '');
      }
    }

    // Limpiar dominios sueltos como "pingback.com" 
    const domainMatches = cleanedLine.match(/\bpingback\.com\b/gi);
    if (domainMatches) {
      for (const domain of domainMatches) {
        removed.push(`🔗 Dominio web inline: ${domain}`);
        cleanedLine = cleanedLine.replace(new RegExp(`\\b${domain}\\b`, 'gi'), '');
      }
    }

    // Limpiar Pingback text
    const pingbackMatches = cleanedLine.match(/\bPingback\.?\b/gi);
    if (pingbackMatches) {
      for (const pb of pingbackMatches) {
        removed.push(`🧹 Metadato web: ${pb}`);
        cleanedLine = cleanedLine.replace(new RegExp(`\\b${pb}\\b`, 'gi'), '');
      }
    }

    // Limpiar rutas web inline (ej: /es/resources/que-es-crm)
    const pathMatches = cleanedLine.match(/\s\/[a-z]{2}\/[\w\/-]+/gi);
    if (pathMatches) {
      for (const path of pathMatches) {
        removed.push(`🔗 Ruta inline: ${path.trim()}`);
        cleanedLine = cleanedLine.replace(path, '');
      }
    }

    // Limpiar metadatos de autor + fecha web inline (ej: "Carolina May 14, 2022.")
    // Busca un nombre, seguido de un mes en inglés o español, un número y el año.
    const dateMatches = cleanedLine.match(/[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+(January|February|March|April|May|June|July|August|September|October|November|December|Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Octubre|Noviembre|Diciembre|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}\.?/gi);
    if (dateMatches) {
      for (const date of dateMatches) {
        removed.push(`📅 Metadato fecha inline: ${date}`);
        cleanedLine = cleanedLine.replace(date, '');
      }
    }

    // Limpiar números de paginación inline pegados al final de una oración o Párrafo (ej "2/9")
    const pageInlineMatches = cleanedLine.match(/\b\d{1,3}\/\d{1,3}\b/g);
    if (pageInlineMatches) {
      for (const page of pageInlineMatches) {
        removed.push(`📄 Paginación inline: ${page}`);
        cleanedLine = cleanedLine.replace(page, '');
      }
    }

    cleanLines.push(cleanedLine);
  }

  let result = cleanLines.join('\n');

  // Regla 7: Unir palabras partidas por guiones de fin de línea
  const hyphenatedMatches = result.match(/(\w+)-\n\s*(\w+)/g);
  if (hyphenatedMatches) {
    for (const match of hyphenatedMatches) {
      const m = match.match(/(\w+)-\n\s*(\w+)/);
      if (m) {
        removed.push(`🔧 Palabra unida: "${m[1]}-${m[2]}" → "${m[1]}${m[2]}"`);
      }
    }
  }
  result = result.replace(/(\w+)-\n\s*(\w+)/g, '$1$2');

  // Regla 8: Sanar oraciones partidas por saltos de línea (wrap text)
  // Si una línea NO termina en puntuación (. , : ; ? !) y la siguiente empieza con minúscula, se unen con espacio.
  const brokenSentenceMatches = result.match(/([^.,:;?!\n])\n+\s*([a-záéíóúñ])/g);
  if (brokenSentenceMatches) {
    for (const match of brokenSentenceMatches) {
      const m = match.match(/([^.,:;?!\n])\n+\s*([a-záéíóúñ])/);
      if (m) {
        removed.push(`🔧 Oración reparada: "...${m[1]} \\n ${m[2]}..."`);
      }
    }
  }
  result = result.replace(/([^.,:;?!\n])\n+\s*([a-záéíóúñ])/g, '$1 $2');

  // Regla 9: Colapsar líneas vacías excesivas
  result = result.replace(/\n{3,}/g, '\n\n');

  // Limpiar espacios dobles dejados por eliminación de URLs inline o números
  result = result.replace(/ {2,}/g, ' ');

  // Limpiar espacios dobles dejados por eliminación de URLs inline
  result = result.replace(/ {2,}/g, ' ');

  return { cleanText: result.trim(), removedFragments: removed };
}

// ═══════════════════════════════════════════
// 2. DETECCIÓN DE TÍTULO + CORRECCIONES (1 llamada IA)
// ═══════════════════════════════════════════

async function callWithFallback(messages: { role: string; content: string }[]): Promise<string> {
  let lastError = "";

  for (const model of MODELS) {
    try {
      console.log(`🤖 Intentando modelo: ${model}`);
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": window.location.href,
          "X-Title": "EdTech TTS",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.1
        })
      });

      if (!resp.ok) {
        const body = await resp.text();
        console.warn(`⚠️ Modelo ${model} falló (${resp.status}): ${body.slice(0, 200)}`);
        lastError = `${model}: ${resp.status}`;
        continue;
      }

      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        lastError = `${model}: respuesta vacía`;
        continue;
      }

      console.log(`✅ Modelo ${model} respondió correctamente`);
      return content;

    } catch (err: any) {
      console.warn(`⚠️ Modelo ${model} error: ${err.message}`);
      lastError = `${model}: ${err.message}`;
      continue;
    }
  }

  throw new Error(`Todos los modelos fallaron. Último: ${lastError}`);
}

interface TitleAndCorrections {
  titulo: string;
  correcciones: { mal: string; bien: string }[];
}

async function detectTitleAndCorrections(textFragment: string): Promise<TitleAndCorrections> {
  const fallback: TitleAndCorrections = { titulo: "", correcciones: [] };

  try {
    const raw = await callWithFallback([
      {
        role: "system",
        content: `Eres un analizador de documentos. Recibirás un fragmento de texto extraído de un PDF o DOCX.

Tu ÚNICO trabajo es devolver un JSON con dos campos:
1. "titulo": El título o tema principal del documento. Debe ser una frase corta y descriptiva.
2. "correcciones": Un array de objetos {mal, bien} indicando lo siguiente:
   - Errores ortográficos o palabras pegadas ("métodoInbound" -> "método Inbound")
   - Meses o fechas que hayan quedado en inglés y requieran traducción literal ("May" -> "mayo", "January" -> "enero")

REGLAS:
- Devuelve SOLO el JSON, sin Markdown.
- Si no hay errores, devuelve "correcciones": [].
- El título debe extraerse del CONTENIDO.

Ejemplo de respuesta:
{"titulo":"¿Qué es un CRM?","correcciones":[{"mal":"métodoInbound","bien":"método Inbound"}, {"mal":"May","bien":"mayo"}]}`
      },
      {
        role: "user",
        content: textFragment.slice(0, 1500)
      }
    ]);

    // Extraer JSON de la respuesta (puede venir envuelto en markdown)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        titulo: parsed.titulo || "",
        correcciones: Array.isArray(parsed.correcciones) ? parsed.correcciones : []
      };
    }
  } catch (err) {
    console.error("Error detectando título:", err);
  }

  return fallback;
}

// ═══════════════════════════════════════════
// 3. ORQUESTADOR PRINCIPAL
// ═══════════════════════════════════════════

export async function cleanDocumentText(
  originalText: string,
  _fileName: string,
  onProgress?: (msg: string) => void
): Promise<CleanResult> {
  // Paso 1: Limpieza regex (instantánea)
  if (onProgress) onProgress("Limpiando con regex...");
  const { cleanText: regexClean, removedFragments } = cleanTextWithRegex(originalText);

  // Paso 2: Detección de título + correcciones (1 llamada IA)
  if (onProgress) onProgress("Detectando título con IA...");
  const { titulo, correcciones } = await detectTitleAndCorrections(regexClean);

  // Paso 3: Aplicar correcciones ortográficas con string.replace
  let finalText = regexClean;
  const appliedCorrections: { mal: string; bien: string }[] = [];

  for (const c of correcciones) {
    if (c.mal && c.bien && c.mal !== c.bien && finalText.includes(c.mal)) {
      finalText = finalText.split(c.mal).join(c.bien);
      appliedCorrections.push(c);
    }
  }

  // Paso 4: Prepender introducción con el título detectado
  if (titulo) {
    finalText = `Hoy revisaremos el texto: "${titulo}".\n\n${finalText}`;
  }

  return {
    cleanText: finalText,
    originalText,
    detectedTitle: titulo,
    removedFragments,
    corrections: appliedCorrections
  };
}
