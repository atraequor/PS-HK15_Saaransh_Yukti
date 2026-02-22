/**
 * CROP SCANNER LOGIC - FarmMind Integrated
 */

/* ── REVEAL & COMMON UI ────────────────────────── */
// (Assuming project.js is also loaded, we can skip redclaring the observer if we want, 
// but for robustness we can just let it exist or use the one from project.js)

const conditionData = {
    'Healthy Leaf': {
        plant: 'General Foliage / Crop Specimen',
        causes: 'Optimized chlorophyll density resulting from ideal photosynthetic conditions, balanced Nitrogen-Phosphorus-Potassium ratios, and regulated irrigation cycles.',
        cure: 'No corrective intervention is required at this stage. Maintain current atmospheric humidity and soil moisture levels to ensure ongoing metabolic efficiency.',
        desc: 'Specimen shows high structural integrity in the leaf cuticle. Recommended prevention involves bi-weekly soil pH monitoring and consistent sanitation of agricultural tools.'
    },
    'Leaf Spot': {
        plant: 'Fungal-Susceptible Specimen',
        causes: 'Pathogenic fungal spores (Cercospora/Septoria) proliferation often triggered by high foliar moisture, air stagnation, and poor canopy ventilation.',
        cure: 'Immediately prune and dispose of infected foliage. Apply organic Neem Oil or copper-based fungicide to halt pathogen expansion and protect adjacent leaves.',
        desc: 'Dark circular lesions with distinct chlorotic halos detected on the surface. Prevent by avoiding overhead irrigation and ensuring proper inter-plant spacing for airflow.'
    },
    'Blight Risk': {
        plant: 'Solanum / High-Risk Specimen',
        causes: 'Rapid pathogen buildup in warm, anaerobic soil conditions combined with high leaf surface wetness and existing plant stress factors.',
        cure: 'Improve soil drainage and apply systemic fungicides early in the cycle. Remove all necrotic plant debris from the topsoil to prevent spore overwintering.',
        desc: 'Fast-spreading tissue damage and vascular degradation identified. Prevention requires crop rotation and implementing a protective fungicidal barrier before rainy periods.'
    },
    'Nutrient Deficiency Risk': {
        plant: 'Mineral-Stressed Specimen',
        causes: 'Low soil mineral availability or incorrect pH levels that lock essential micronutrients like Nitrogen, Magnesium, or Iron from root uptake.',
        cure: 'Conduct a comprehensive soil test to identify specific mineral gaps. Apply slow-release balanced fertilizer and introduce organic compost to improve soil structure.',
        desc: 'Chlorosis patterns or patchy discoloration observed in the vein regions. Prevention involves regular soil aeration and maintaining a consistent organic mulching layer.'
    }
};

/* ── ANALYSIS ENGINE ──────────────────────────── */

/* ── UI CONTROLLERS ─────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
    const upload = document.getElementById('leafUpload');
    const preview = document.getElementById('preview');
    const outputSmallPreview = document.getElementById('outputSmallPreview');
    const scanButton = document.getElementById('scanBtnAction');
    const inputPage = document.getElementById('inputPage');
    const outputPage = document.getElementById('outputPage');

    if (upload) {
        upload.addEventListener('change', function () {
            const file = this.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = e => {
                    preview.src = e.target.result;
                    outputSmallPreview.src = e.target.result;
                    preview.style.display = 'block';
                    const placeholder = document.getElementById('placeholderText');
                    if (placeholder) placeholder.style.display = 'none';
                    if (scanButton) scanButton.disabled = false;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    window.scanDisease = async function () {
        if (!preview.src || preview.style.display === 'none') return;

        // Loading state
        const originalBtnText = scanButton.innerHTML;
        scanButton.disabled = true;
        scanButton.innerHTML = `
            <span class="btn-pri-icon" style="animation: spin 1s linear infinite;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
                </svg>
            </span>
            Analyzing...`;

        try {
            const response = await authFetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: preview.src,
                    hint: "Leaf/crop disease scan. Identify if plant; if plant, name disease or healthy."
                })
            });

            if (!response.ok) throw new Error('Analysis failed');

            const result = await response.json();

            // Strict check if it is not a plant
            if (result.is_plant === false) {
                alert("⚠️ NOT A PLANT: " + (result.is_not_plant_reason || result.observation || "Please upload a clear plant image."));
                scanButton.disabled = false;
                scanButton.innerHTML = originalBtnText;
                return;
            }

            // Map AI result to our local detailed condition data if possible, otherwise use AI text
            let diseaseName = result.disease || "Unknown Condition";
            let localData = null;

            // Simple fuzzy matching for local detailed data
            if (diseaseName.toLowerCase().includes('healthy')) localData = conditionData['Healthy Leaf'];
            else if (diseaseName.toLowerCase().includes('spot')) localData = conditionData['Leaf Spot'];
            else if (diseaseName.toLowerCase().includes('blight')) localData = conditionData['Blight Risk'];
            else if (diseaseName.toLowerCase().includes('deficiency')) localData = conditionData['Nutrient Deficiency Risk'];

            const diseaseNameEl = document.getElementById('diseaseName');
            const causeTextEl = document.getElementById('causeText');
            const cureTextEl = document.getElementById('cureText');
            const descTextEl = document.getElementById('descText');

            if (diseaseNameEl) diseaseNameEl.innerText = diseaseName;

            if (localData) {
                if (causeTextEl) causeTextEl.innerHTML = localData.causes;
                if (cureTextEl) cureTextEl.innerHTML = localData.cure;
                if (descTextEl) {
                    descTextEl.innerHTML = `<strong>Confidence:</strong> ${result.confidence}<br><strong>AI Observation:</strong> ${result.observation}<br><br>${localData.desc}`;
                }
            } else {
                // If AI finds something else, show AI output directly
                if (causeTextEl) causeTextEl.innerHTML = "Analysis in progress...";
                if (cureTextEl) cureTextEl.innerHTML = "Please consult an agronomist for specific treatment based on the observations.";
                if (descTextEl) {
                    descTextEl.innerHTML = `<strong>Confidence:</strong> ${result.confidence}<br><strong>AI Observation:</strong> ${result.observation}`;
                }
            }

            if (inputPage) inputPage.style.display = 'none';
            if (outputPage) {
                outputPage.style.display = 'block';
                outputPage.classList.add('fade-in');
            }
        } catch (error) {
            console.error('Scan error:', error);
            alert("Connection Error: Ensure the AI Backend server is running.");
        } finally {
            scanButton.disabled = false;
            scanButton.innerHTML = originalBtnText;
        }
    };

    window.resetUI = function () {
        if (outputPage) outputPage.style.display = 'none';
        if (inputPage) inputPage.style.display = 'block';
        if (preview) preview.style.display = 'none';
        const placeholder = document.getElementById('placeholderText');
        if (placeholder) placeholder.style.display = 'block';
        if (upload) upload.value = '';
        if (scanButton) scanButton.disabled = true;
    };

    window.saveDiagnosisReport = function (event) {
        const btn = event.currentTarget || event.target;
        const originalText = btn.innerHTML;
        btn.innerText = "CAPTURING...";
        const captureArea = document.getElementById('captureArea');

        html2canvas(captureArea, {
            backgroundColor: "#FFFFFF",
            scale: 2,
            logging: false
        }).then(canvas => {
            const link = document.createElement('a');
            link.download = 'Plant_Analysis_Report.png';
            link.href = canvas.toDataURL("image/png");
            link.click();
            btn.innerHTML = originalText;
        });
    };
});

