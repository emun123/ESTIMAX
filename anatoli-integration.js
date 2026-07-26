// ═══════════════════════════════════════════════════════════════
// ANATOLI INTEGRATION - AI-Powered Vehicle Damage Analysis
// ═══════════════════════════════════════════════════════════════

// Configuration - Cowork Skill Integration
const ANATOLI_CONFIG = {
  // Using Cowork Skill "anatoli" instead of external API
  skillName: 'anatoli',
  method: 'cowork_skill', // Direct Cowork Skill call
  timeout: 60000, // 60 seconds for AI analysis
  maxFileSize: 10 * 1024 * 1024, // 10MB
  supportedFormats: ['image/jpeg', 'image/png', 'image/webp'],
  // Fallback for testing
  fallbackEndpoint: window.location.origin + '/api/anatoli'
};

// ═══════════════════════════════════════════════════════════════
// 1. UPLOAD & ANALYZE PHOTO
// ═══════════════════════════════════════════════════════════════

async function uploadAndAnalyzePhoto(file, caseId) {
  try {
    // Validate file
    if (!validatePhotoFile(file)) {
      throw new Error('Invalid photo format or size');
    }

    console.log('📤 Uploading to Anatoli:', file.name);

    // Upload to Firebase Storage first
    const photoUrl = await uploadPhotoToStorage(file, caseId);

    // Send to Anatoli for analysis
    console.log('🤖 Analyzing with Anatoli...');
    const analysis = await analyzePhotoWithAnatoli(photoUrl.url, caseId);

    // Save analysis to Firestore
    if (analysis) {
      await saveAnatolicAnalysis(caseId, analysis);
      return analysis;
    }

  } catch (error) {
    console.error('❌ Upload/Analysis failed:', error);
    handleAnatolicError(error);
    return null;
  }
}

// Validate photo before upload
function validatePhotoFile(file) {
  if (file.size > ANATOLI_CONFIG.maxFileSize) {
    throw new Error('תמונה גדולה מדי (מקסימום 10MB)');
  }
  if (!ANATOLI_CONFIG.supportedFormats.includes(file.type)) {
    throw new Error('פורמט תמונה לא נתמך');
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════
// 2. SEND TO ANATOLI API
// ═══════════════════════════════════════════════════════════════

async function analyzePhotoWithAnatoli(photoUrl, caseId) {
  console.log('🤖 Calling Anatoli Cowork Skill...');

  try {
    // Method 1: Use Cowork Skill API if available
    if (window.cowork && window.cowork.callMcpTool) {
      console.log('📞 Using Cowork MCP Tool...');
      return await callAnatolicViaCowork(photoUrl, caseId);
    }

    // Method 2: Fallback to HTTP endpoint
    console.log('📡 Using HTTP endpoint (fallback)...');
    return await callAnatolicViaHTTP(photoUrl, caseId);

  } catch (error) {
    console.error('❌ Anatoli analysis failed:', error);
    throw error;
  }
}

// Call Anatoli through Cowork Skill
async function callAnatolicViaCowork(photoUrl, caseId) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANATOLI_CONFIG.timeout);

  try {
    // Format request for Anatoli skill
    const request = {
      method: 'POST',
      body: JSON.stringify({
        caseId: caseId,
        photoUrl: photoUrl,
        vehicleInfo: {
          licensePlate: document.getElementById('licensePlate')?.value || '',
          model: document.getElementById('vehicleModel')?.value || ''
        },
        language: 'he'
      }),
      signal: controller.signal
    };

    // Call Anatoli skill via Cowork
    const response = await window.cowork.callMcpTool('anatoli', request);
    clearTimeout(timeoutId);

    console.log('✅ Anatoli response (Cowork):', response);
    return parseAnatolicResponse(response);

  } catch (error) {
    clearTimeout(timeoutId);
    console.error('❌ Cowork call failed:', error);
    throw error;
  }
}

// Fallback: HTTP endpoint
async function callAnatolicViaHTTP(photoUrl, caseId) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANATOLI_CONFIG.timeout);

  try {
    const response = await fetch(ANATOLI_CONFIG.fallbackEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client': 'Estimax/1.0',
        'X-Case-ID': caseId
      },
      body: JSON.stringify({
        caseId: caseId,
        photoUrl: photoUrl,
        analysisType: 'damage_assessment',
        language: 'he'
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Anatoli HTTP error: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ Anatoli response (HTTP):', result);
    return parseAnatolicResponse(result);

  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Anatoli analysis timeout');
    }
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. PARSE ANATOLI RESPONSE
// ═══════════════════════════════════════════════════════════════

function parseAnatolicResponse(response) {
  /*
  Expected Anatoli API Response:
  {
    "status": "success",
    "caseId": "2026-047",
    "analysis": {
      "damageLevel": "moderate",
      "affectedAreas": ["front-left", "bumper"],
      "confidence": 0.95,
      "parts": [
        {
          "partId": "OEM-123456",
          "name": "Left Bumper",
          "manufacturer": "Original",
          "estimatedCost": 4500,
          "replacementRequired": true,
          "partNumber": "12345-67890"
        }
      ],
      "labor": {
        "estimatedHours": 8,
        "hourlyRate": 150,
        "totalLaborCost": 1200,
        "complexity": "medium"
      },
      "totalEstimate": 5700,
      "recommendations": "Replace bumper and repaint",
      "insuranceCoverage": "covered",
      "repairTimeline": "3-5 days"
    }
  }
  */

  if (response.status !== 'success') {
    throw new Error(`Anatoli analysis failed: ${response.status}`);
  }

  const analysis = response.analysis || {};

  return {
    status: 'completed',
    timestamp: new Date(),
    damageLevel: analysis.damageLevel || 'unknown',
    affectedAreas: analysis.affectedAreas || [],
    confidence: analysis.confidence || 0,
    parts: parseParts(analysis.parts || []),
    labor: parseLabor(analysis.labor || {}),
    totalEstimate: analysis.totalEstimate || 0,
    recommendations: analysis.recommendations || '',
    insuranceCoverage: analysis.insuranceCoverage || 'unknown',
    repairTimeline: analysis.repairTimeline || '',
    rawResponse: response
  };
}

function parseParts(parts) {
  return parts.map(part => ({
    partId: part.partId,
    name: part.name,
    manufacturer: part.manufacturer,
    cost: part.estimatedCost || 0,
    required: part.replacementRequired || false,
    partNumber: part.partNumber || ''
  }));
}

function parseLabor(labor) {
  return {
    hours: labor.estimatedHours || 0,
    hourlyRate: labor.hourlyRate || 0,
    totalCost: labor.totalLaborCost || 0,
    complexity: labor.complexity || 'unknown'
  };
}

// ═══════════════════════════════════════════════════════════════
// 4. SAVE ANALYSIS TO FIRESTORE
// ═══════════════════════════════════════════════════════════════

async function saveAnatolicAnalysis(caseId, analysis) {
  try {
    const caseRef = db.collection('cases').doc(caseId);

    await caseRef.update({
      anatoli_analysis: {
        status: 'completed',
        damageLevel: analysis.damageLevel,
        affectedAreas: analysis.affectedAreas,
        confidence: analysis.confidence,
        parts: analysis.parts,
        labor: analysis.labor,
        totalEstimate: analysis.totalEstimate,
        recommendations: analysis.recommendations,
        insuranceCoverage: analysis.insuranceCoverage,
        repairTimeline: analysis.repairTimeline,
        analyzedAt: new Date()
      },
      estimatedAmount: analysis.totalEstimate,
      updatedAt: new Date()
    });

    console.log('✅ Analysis saved to Firestore');
    return true;

  } catch (error) {
    console.error('❌ Failed to save analysis:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. DISPLAY RESULTS IN UI
// ═══════════════════════════════════════════════════════════════

function displayAnatolicResult(analysis) {
  if (!analysis) {
    showResultError('ניתוח נכשל - נסה שוב');
    return;
  }

  const html = `
    <div style="background: var(--blue-light); border-radius: 12px; padding: 20px; margin: 16px 0; border-left: 4px solid var(--blue);">
      <h3 style="color: var(--blue); margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
        🤖 ניתוח Anatoli
        <span style="font-size: 12px; background: var(--green-light); color: var(--green); padding: 2px 8px; border-radius: 12px;">
          ✓ הושלם
        </span>
      </h3>

      <!-- Damage Level -->
      <div style="margin-bottom: 16px; padding: 12px; background: rgba(255,255,255,0.5); border-radius: 8px;">
        <p style="margin: 0; font-size: 12px; color: var(--text2); font-weight: 600; margin-bottom: 4px;">רמת נזק</p>
        <p style="margin: 0; font-size: 16px; font-weight: 600; color: var(--blue);">
          ${getDamageLevelLabel(analysis.damageLevel)}
        </p>
        <p style="margin: 4px 0 0; font-size: 11px; color: var(--text3);">
          ביטחון: ${Math.round(analysis.confidence * 100)}%
        </p>
      </div>

      <!-- Affected Areas -->
      ${analysis.affectedAreas.length > 0 ? `
        <div style="margin-bottom: 16px;">
          <p style="margin: 0 0 8px; font-size: 12px; color: var(--text2); font-weight: 600;">אזורים מושפעים</p>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${analysis.affectedAreas.map(area => `
              <span style="background: var(--amber-light); color: var(--amber); padding: 4px 10px; border-radius: 20px; font-size: 12px;">
                ${area}
              </span>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Parts Required -->
      ${analysis.parts.length > 0 ? `
        <div style="margin-bottom: 16px; padding: 12px; background: rgba(255,255,255,0.5); border-radius: 8px;">
          <p style="margin: 0 0 12px; font-size: 12px; color: var(--text2); font-weight: 600;">🔧 חלקים נדרשים</p>
          ${analysis.parts.map(part => `
            <div style="margin-bottom: 8px; padding: 8px; background: white; border-radius: 6px;">
              <p style="margin: 0; font-size: 13px; font-weight: 500; color: var(--text);">
                ${part.name} ${part.required ? '(חובה)' : '(אופציונלי)'}
              </p>
              <div style="display: flex; justify-content: space-between; margin-top: 4px;">
                <span style="font-size: 11px; color: var(--text2);">${part.manufacturer}</span>
                <span style="font-size: 12px; font-weight: 600; color: var(--blue);">₪${part.cost.toLocaleString('he-IL')}</span>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- Summary Box -->
      <div style="background: white; border: 1px solid var(--border); border-radius: 8px; padding: 14px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
          <div>
            <p style="margin: 0; font-size: 11px; color: var(--text2);">עלות חלקים</p>
            <p style="margin: 4px 0 0; font-size: 16px; font-weight: 600; color: var(--text);">
              ₪${analysis.parts.reduce((sum, p) => sum + p.cost, 0).toLocaleString('he-IL')}
            </p>
          </div>
          <div>
            <p style="margin: 0; font-size: 11px; color: var(--text2);">עלות עבודה</p>
            <p style="margin: 4px 0 0; font-size: 16px; font-weight: 600; color: var(--text);">
              ₪${analysis.labor.totalCost.toLocaleString('he-IL')}
            </p>
          </div>
        </div>
        <div style="border-top: 1px solid var(--border); padding-top: 12px;">
          <p style="margin: 0; font-size: 11px; color: var(--text2);">סה"כ הערכה</p>
          <p style="margin: 8px 0 0; font-size: 24px; font-weight: 700; color: var(--blue);">
            ₪${analysis.totalEstimate.toLocaleString('he-IL')}
          </p>
        </div>
      </div>

      <!-- Recommendations -->
      ${analysis.recommendations ? `
        <div style="margin-top: 16px; padding: 12px; background: rgba(255,255,255,0.5); border-radius: 8px;">
          <p style="margin: 0 0 8px; font-size: 12px; color: var(--text2); font-weight: 600;">💡 המלצות</p>
          <p style="margin: 0; font-size: 13px; color: var(--text); line-height: 1.5;">
            ${analysis.recommendations}
          </p>
        </div>
      ` : ''}

      <!-- Timeline & Coverage -->
      <div style="margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div style="padding: 10px; background: rgba(255,255,255,0.5); border-radius: 6px;">
          <p style="margin: 0; font-size: 11px; color: var(--text2);">⏱️ לוח זמנים</p>
          <p style="margin: 4px 0 0; font-size: 13px; font-weight: 500; color: var(--text);">
            ${analysis.repairTimeline || 'לא ידוע'}
          </p>
        </div>
        <div style="padding: 10px; background: rgba(255,255,255,0.5); border-radius: 6px;">
          <p style="margin: 0; font-size: 11px; color: var(--text2);">📋 ביטוח</p>
          <p style="margin: 4px 0 0; font-size: 13px; font-weight: 500; color: var(--green);">
            ✓ ${analysis.insuranceCoverage === 'covered' ? 'מכוסה' : 'לא מכוסה'}
          </p>
        </div>
      </div>
    </div>
  `;

  const resultContainer = document.getElementById('anatoli-result');
  if (resultContainer) {
    resultContainer.innerHTML = html;
  }
}

function getDamageLevelLabel(level) {
  const labels = {
    'minor': '🟢 קל',
    'moderate': '🟡 בינוני',
    'severe': '🔴 חמור'
  };
  return labels[level] || '❓ לא ידוע';
}

function showResultError(message) {
  const resultContainer = document.getElementById('anatoli-result');
  if (resultContainer) {
    resultContainer.innerHTML = `
      <div style="background: #FCEBEB; border-left: 4px solid var(--red); border-radius: 8px; padding: 12px;">
        <p style="margin: 0; font-size: 13px; color: var(--red);">
          ❌ ${message}
        </p>
      </div>
    `;
  }
}

// ═══════════════════════════════════════════════════════════════
// 6. ERROR HANDLING
// ═══════════════════════════════════════════════════════════════

const ANATOLI_ERRORS = {
  'INVALID_IMAGE': '❌ תמונה לא ברורה או פגומה',
  'TIMEOUT': '⏱️ Anatoli לא פוגע בזמן - נסה שוב',
  'INSUFFICIENT_DAMAGE': '⚠️ לא זוהה נזק משמעותי',
  'API_ERROR': '❌ שגיאה בשרת Anatoli',
  'INVALID_FORMAT': '❌ פורמט קובץ לא נתמך',
  'FILE_TOO_LARGE': '❌ הקובץ גדול מדי',
  'UNAUTHORIZED': '🔐 אנא התחבר קודם',
  'NETWORK_ERROR': '🌐 בעיה בחיבור לאינטרנט'
};

function handleAnatolicError(error) {
  console.error('Anatoli error:', error);

  let errorKey = 'API_ERROR';
  if (error.message.includes('Invalid')) errorKey = 'INVALID_IMAGE';
  if (error.message.includes('timeout')) errorKey = 'TIMEOUT';
  if (error.message.includes('not authenticated')) errorKey = 'UNAUTHORIZED';
  if (error.message.includes('size')) errorKey = 'FILE_TOO_LARGE';
  if (error.message.includes('format')) errorKey = 'INVALID_FORMAT';

  const message = ANATOLI_ERRORS[errorKey] || error.message;
  showResultError(message);

  // Optional: Log error to Firestore for monitoring
  logAnatolicError({
    errorKey,
    message: error.message,
    timestamp: new Date(),
    userAgent: navigator.userAgent
  });
}

async function logAnatolicError(errorData) {
  try {
    await db.collection('anatoli_errors').add(errorData);
  } catch (e) {
    console.error('Failed to log error:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// 7. WEBHOOK LISTENER (Optional - for Anatoli to send updates)
// ═══════════════════════════════════════════════════════════════

/*
// Add to Firebase Cloud Functions (optional):
// POST /api/anatoli-webhook
// {
//   "caseId": "2026-047",
//   "status": "completed",
//   "analysis": {...}
// }

exports.anatolicWebhook = functions.https.onRequest((req, res) => {
  const { caseId, status, analysis } = req.body;

  db.collection('cases').doc(caseId).update({
    anatoli_analysis: {
      status: status,
      ...analysis,
      webhookReceivedAt: admin.firestore.Timestamp.now()
    }
  });

  res.json({ success: true });
});
*/

console.log('✅ Anatoli Integration loaded');
