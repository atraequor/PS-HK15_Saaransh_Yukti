/*
  AI Farmer Copilot - Front-End Controller
  - Reads farmer profile from the backend database.
  - Sends chat messages to the server, which calls the LLM.
*/

// ------------------------------
// Configuration
// ------------------------------
const LLM_CONFIG = {
    endpoint: "/api/chat",
    timeoutMs: 45000
};

const PROFILE_CACHE_KEY = "ai-farmer-profile-cache-v1";

const DEFAULT_PROFILE = {
    location: "",
    soil: "",
    crop: "",
    skills: "Beginner"
};

let serverProfile = null;
let profileState = { ...DEFAULT_PROFILE };

// ------------------------------
// Element Cache
// ------------------------------
const elements = {
    statusBadge: document.getElementById("statusBadge"),
    contextPill: document.getElementById("contextPill"),
    chatHistory: document.getElementById("chatHistory"),
    chatEmpty: document.getElementById("chatEmpty"),
    chatForm: document.getElementById("chatForm"),
    userMessage: document.getElementById("userMessage"),
    sendMessage: document.getElementById("sendMessage"),
    voiceStub: document.getElementById("voiceStub"),
    quickActions: document.getElementById("quickActions"),
    profileLocation: document.getElementById("profileLocation"),
    profileSoil: document.getElementById("profileSoil"),
    profileCrop: document.getElementById("profileCrop"),
    profileSkills: document.getElementById("profileSkills"),
    profileHint: document.getElementById("profileHint"),
    openProfile: document.getElementById("openProfile"),
    editProfileInline: document.getElementById("editProfileInline"),
    profileDrawer: document.getElementById("profileDrawer"),
    profileForm: document.getElementById("profileForm")
};

// ------------------------------
// Profile Helpers
// ------------------------------
function normalizeProfile(profile) {
    return {
        location: String(profile.location || "").trim(),
        soil: String(profile.soil || "").trim(),
        crop: String(profile.crop || "").trim(),
        skills: String(profile.skills || "Beginner").trim() || "Beginner"
    };
}

function profileIsComplete(profile) {
    return Boolean(profile.location && profile.soil && profile.crop && profile.skills);
}

function loadProfileCache() {
    try {
        const raw = localStorage.getItem(PROFILE_CACHE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed ? normalizeProfile(parsed) : null;
    } catch (err) {
        return null;
    }
}

function saveProfileCache(profile) {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
}

function deriveSkillLevelFromServer(user) {
    if (!user) return "Beginner";
    if (user.skill_level) return user.skill_level;
    const role = String(user.role || "").toLowerCase();
    if (role.includes("tech")) return "Tech-Savvy";
    const exp = Number(user.experience_yrs || 0);
    if (exp >= 8) return "Traditional";
    return "Beginner";
}

function mapServerProfile(user) {
    const location = [user?.district, user?.state].filter(Boolean).join(", ");
    return normalizeProfile({
        location,
        soil: user?.soil_type || "",
        crop: user?.primary_crop || "",
        skills: user?.skill_level || deriveSkillLevelFromServer(user)
    });
}

function splitLocationInput(input, fallback) {
    const trimmed = String(input || "").trim();
    if (!trimmed) return { district: fallback?.district || null, state: fallback?.state || null };
    const parts = trimmed.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
        return { district: parts[0], state: parts.slice(1).join(", ") };
    }
    return { district: trimmed, state: fallback?.state || null };
}

async function fetchProfileFromServer() {
    const response = await fetch("/api/auth/me", { method: "GET" });
    if (!response.ok) {
        throw new Error("Failed to load profile from server.");
    }
    const user = await response.json();
    serverProfile = user;
    profileState = mapServerProfile(user);
    saveProfileCache(profileState);
    updateProfileUI(profileState);
    hydrateProfileForm(profileState);
    return profileState;
}

async function saveProfileToServer(profile) {
    if (!serverProfile) {
        await fetchProfileFromServer();
    }

    const locationParts = splitLocationInput(profile.location, serverProfile || {});

    const payload = {
        full_name: serverProfile?.full_name || "Guest Farmer",
        phone: serverProfile?.phone || null,
        state: locationParts.state || serverProfile?.state || null,
        district: locationParts.district || serverProfile?.district || null,
        role: serverProfile?.role || "farmer",
        experience_yrs: serverProfile?.experience_yrs || 0,
        farm_size_acres: serverProfile?.farm_size_acres || null,
        primary_crop: profile.crop || null,
        soil_type: profile.soil || null,
        irrigation_src: serverProfile?.irrigation_src || null,
        skill_level: profile.skills || null
    };

    const response = await fetch("/api/auth/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data?.error || "Profile update failed.");
    }

    serverProfile = { ...serverProfile, ...payload, ...(data.user || {}) };
    profileState = mapServerProfile(serverProfile);
    saveProfileCache(profileState);
    updateProfileUI(profileState);
    hydrateProfileForm(profileState);
    return profileState;
}

function hydrateProfileForm(profile) {
    const formElements = elements.profileForm.elements;
    formElements.namedItem("location").value = profile.location || "";
    formElements.namedItem("soil").value = profile.soil || "";
    formElements.namedItem("crop").value = profile.crop || "";
    formElements.namedItem("skills").value = profile.skills || "Beginner";
}

// ------------------------------
// UI Rendering
// ------------------------------
function updateProfileUI(profile) {
    elements.profileLocation.textContent = profile.location || "Not set";
    elements.profileSoil.textContent = profile.soil || "Not set";
    elements.profileCrop.textContent = profile.crop || "Not set";
    elements.profileSkills.textContent = profile.skills || "Not set";

    const complete = profileIsComplete(profile);
    elements.profileHint.textContent = complete
        ? "Profile synced to database. Copilot context is ready."
        : "Complete your profile to unlock crop-specific quick actions.";

    elements.contextPill.textContent = complete ? "Context ready" : "Context incomplete";
    elements.contextPill.style.opacity = complete ? "1" : "0.7";

    renderQuickActions(profile);
}

function setStatus(text) {
    elements.statusBadge.textContent = text;
}

function toggleDrawer(open) {
    if (open) {
        elements.profileDrawer.classList.add("show");
        elements.profileDrawer.setAttribute("aria-hidden", "false");
    } else {
        elements.profileDrawer.classList.remove("show");
        elements.profileDrawer.setAttribute("aria-hidden", "true");
    }
}

function toggleSendingState(isSending) {
    elements.sendMessage.disabled = isSending;
    elements.userMessage.disabled = isSending;
    setStatus(isSending ? "Thinking..." : "Ready");
}

function appendMessage(role, content, metaText) {
    const message = document.createElement("div");
    message.className = `message ${role}`;

    const contentWrap = document.createElement("div");
    contentWrap.className = "message-content";

    if (role === "assistant") {
        contentWrap.innerHTML = formatMarkdown(content);
    } else {
        contentWrap.textContent = content;
    }

    message.appendChild(contentWrap);

    if (metaText) {
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = metaText;
        message.appendChild(meta);
    }

    elements.chatHistory.appendChild(message);
    elements.chatEmpty.style.display = "none";
    elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
    return message;
}

// ------------------------------
// Quick Actions
// ------------------------------
const QUICK_ACTIONS = {
    default: [
        "Any pest warnings today?",
        "Should I irrigate this week?",
        "Summarize soil health risks.",
        "Log a field observation."
    ],
    rice: [
        "Any pest warnings today?",
        "Check water depth and irrigation timing.",
        "Nutrient top-up recommendation?",
        "Log a field observation."
    ],
    wheat: [
        "Should I irrigate this week?",
        "Early signs of rust?",
        "Nitrogen top-dress guidance.",
        "Log a field observation."
    ],
    cotton: [
        "Any bollworm alerts?",
        "Should I irrigate?",
        "Growth stage-based nutrient guidance.",
        "Log a field observation."
    ],
    maize: [
        "Any fall armyworm alerts?",
        "Irrigation timing for tasseling stage.",
        "Leaf color and nutrient balance check.",
        "Log a field observation."
    ]
};

function renderQuickActions(profile) {
    const cropKey = String(profile.crop || "").trim().toLowerCase();
    const actions = QUICK_ACTIONS[cropKey] || QUICK_ACTIONS.default;

    elements.quickActions.innerHTML = "";
    actions.forEach((text) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip";
        chip.textContent = text;
        chip.addEventListener("click", () => {
            elements.userMessage.value = text;
            elements.userMessage.focus();
        });
        elements.quickActions.appendChild(chip);
    });
}

// ------------------------------
// LLM Connector
// ------------------------------
async function fetchCopilotResponse(userMessage) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_CONFIG.timeoutMs);

    try {
        const response = await fetch(LLM_CONFIG.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: userMessage,
                device_timestamp: new Date().toISOString()
            }),
            signal: controller.signal
        });

        const rawText = await response.text();
        if (!response.ok) {
            throw new Error(rawText || "LLM request failed.");
        }

        try {
            const parsed = JSON.parse(rawText);
            return parsed?.reply || parsed?.message || rawText;
        } catch (err) {
            return rawText;
        }
    } finally {
        clearTimeout(timeout);
    }
}

// ------------------------------
// Markdown Lite Rendering
// ------------------------------
function escapeHTML(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function applyInlineFormats(text) {
    return text
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

function formatMarkdown(input) {
    const lines = escapeHTML(input).split(/\r?\n/);
    let html = "";
    let inList = false;

    lines.forEach((line) => {
        const headingMatch = line.match(/^#{2,3}\s+(.*)/);
        const listMatch = line.match(/^[-*]\s+(.*)/);

        if (headingMatch) {
            if (inList) {
                html += "</ul>";
                inList = false;
            }
            html += `<h4>${applyInlineFormats(headingMatch[1])}</h4>`;
            return;
        }

        if (listMatch) {
            if (!inList) {
                html += "<ul>";
                inList = true;
            }
            html += `<li>${applyInlineFormats(listMatch[1])}</li>`;
            return;
        }

        if (line.trim() === "") {
            if (inList) {
                html += "</ul>";
                inList = false;
            }
            html += "<div class=\"spacer\"></div>";
            return;
        }

        if (inList) {
            html += "</ul>";
            inList = false;
        }

        html += `<p>${applyInlineFormats(line)}</p>`;
    });

    if (inList) html += "</ul>";
    return html;
}

// ------------------------------
// Event Wiring
// ------------------------------
function bindEvents() {
    elements.openProfile.addEventListener("click", () => toggleDrawer(true));
    elements.editProfileInline.addEventListener("click", () => toggleDrawer(true));

    elements.profileDrawer.addEventListener("click", (event) => {
        if (event.target && event.target.dataset.close === "true") {
            toggleDrawer(false);
        }
    });

    elements.profileDrawer.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            toggleDrawer(false);
        }
    });

    elements.profileForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(elements.profileForm);
        const profile = normalizeProfile({
            location: formData.get("location"),
            soil: formData.get("soil"),
            crop: formData.get("crop"),
            skills: formData.get("skills")
        });

        try {
            setStatus("Saving...");
            await saveProfileToServer(profile);
            toggleDrawer(false);
            setStatus("Ready");
        } catch (err) {
            setStatus("Profile save failed");
        }
    });

    elements.chatForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        await handleSend();
    });

    elements.userMessage.addEventListener("keydown", async (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            await handleSend();
        }
    });

    elements.voiceStub.addEventListener("click", () => {
        appendMessage("assistant", "Voice input is coming soon. For now, type your observation.", "Copilot");
    });
}

async function handleSend() {
    const text = elements.userMessage.value.trim();
    if (!text) return;

    elements.userMessage.value = "";
    appendMessage("user", text, "You");

    toggleSendingState(true);

    const placeholder = appendMessage("assistant", "Thinking...", "Copilot");

    try {
        const responseText = await fetchCopilotResponse(text);
        placeholder.querySelector(".message-content").innerHTML = formatMarkdown(responseText);
    } catch (err) {
        placeholder.querySelector(".message-content").textContent =
            "Unable to reach the copilot backend. Check your server configuration.";
    } finally {
        toggleSendingState(false);
        elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
    }
}

// ------------------------------
// Init
// ------------------------------
(function init() {
    const cached = loadProfileCache();
    if (cached) {
        profileState = cached;
        updateProfileUI(profileState);
        hydrateProfileForm(profileState);
    } else {
        updateProfileUI(profileState);
        hydrateProfileForm(profileState);
    }

    fetchProfileFromServer().catch(() => {
        if (!cached) {
            elements.profileHint.textContent = "Unable to reach profile service. Using local defaults.";
        }
    });

    bindEvents();
})();
