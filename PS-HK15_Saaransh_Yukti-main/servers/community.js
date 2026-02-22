/* ── THE YARD: COMMUNITY LOGIC ── */

const $ = id => document.getElementById(id);
let lastPostsJson = '';
let attachedMedia = [];
let allPosts = [];

document.addEventListener('DOMContentLoaded', () => {
    initUser();
    loadStats();
    loadPosts();
    // Auto-refresh every 5 seconds for real-time feel
    setInterval(() => {
        loadPosts(true);
        loadStats();
    }, 5000);

    $('mediaBtn').onclick = () => $('mediaInput').click();

    $('mediaInput').onchange = (e) => {
        const files = Array.from(e.target.files || []).slice(0, 6);
        if (!files.length) return;

        Promise.all(files.map(file => new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(ev.target.result);
            reader.readAsDataURL(file);
        }))).then((items) => {
            attachedMedia = items;
            renderMediaPreview();
        });
    };

    $('clearMedia').onclick = () => {
        attachedMedia = [];
        $('mediaInput').value = '';
        $('mediaPreview').style.display = 'none';
        $('previewGrid').innerHTML = '';
    };

    $('publishPost').onclick = async () => {
        const content = $('postContent').value.trim();
        const category = $('postCategory').value;

        if (!content) return;

        $('publishPost').disabled = true;
        $('publishPost').innerText = 'Publishing...';

        try {
            const res = await authFetch('/api/community/posts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content,
                    category,
                    media_urls: attachedMedia
                })
            });

            if (res.ok) {
                $('postContent').value = '';
                $('clearMedia').click();
                loadPosts();
                loadStats();
            }
        } catch (e) {
            console.error('Post failed', e);
        } finally {
            $('publishPost').disabled = false;
            $('publishPost').innerText = 'Publish Post';
        }
    };

    $('feedSearch').addEventListener('input', () => applyFeedSearch());
});

function initUser() {
    const user = JSON.parse(localStorage.getItem('fm_user') || '{}');
    if (user.full_name) {
        $('myName').textContent = user.full_name;
        $('myAvatar').textContent = user.full_name[0];
        $('myBio').textContent = `${user.primary_crop || 'Farmer'} · ${user.district || 'India'}`;
    }
}

function renderMediaPreview() {
    const box = $('mediaPreview');
    const grid = $('previewGrid');
    if (!attachedMedia.length) {
        box.style.display = 'none';
        grid.innerHTML = '';
        return;
    }

    grid.innerHTML = attachedMedia.map(src => {
        const isVideo = src.startsWith('data:video/');
        return isVideo
            ? `<video src="${src}" muted controls style="width:100%; height:72px; object-fit:cover; border-radius:8px; border:1px solid var(--border);"></video>`
            : `<img src="${src}" style="width:100%; height:72px; object-fit:cover; border-radius:8px; border:1px solid var(--border);">`;
    }).join('');
    box.style.display = 'block';
}

async function loadStats() {
    try {
        const res = await authFetch('/api/community/stats');
        if (res.ok) {
            const stats = await res.json();
            $('postsCount').textContent = stats.posts;
            $('seedsEarned').textContent = stats.likes_earned;
        }
    } catch (e) { }
}

async function loadPosts(isAutoPoll = false) {
    const feed = $('communityFeed');
    try {
        const res = await authFetch('/api/community/posts');
        const posts = await res.json();

        // Check for changes to avoid unnecessary re-renders
        const postsJson = JSON.stringify(posts);
        if (postsJson === lastPostsJson) return;

        // If auto-polling, don't refresh if user is busy (typing or has comments open)
        if (isAutoPoll) {
            const hasOpenComments = !!document.querySelector('.comments-section[style*="display: block"]');
            const isTyping = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
            if (hasOpenComments || isTyping) return;
        }

        lastPostsJson = postsJson;

        if (posts.length === 0) {
            feed.innerHTML = `<div class="post-card" style="text-align:center; color: var(--ink-low);">The fields are quiet. Start the conversation.</div>`;
            allPosts = [];
            return;
        }
        allPosts = posts;
        applyFeedSearch();
    } catch (e) {
        feed.innerHTML = `<div class="post-card">Connectivity issues in the yard.</div>`;
    }
}

function normalizeMedia(post) {
    if (!post.image_url) return [];
    try {
        const parsed = JSON.parse(post.image_url);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) { }
    return [post.image_url];
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderExpandableText(text, kind, id, limit = 220) {
    const raw = String(text || '');
    const safe = escapeHtml(raw);
    const needsMore = raw.length > limit;
    if (!needsMore) return `<div class="${kind}">${safe}</div>`;

    const short = escapeHtml(raw.slice(0, limit)) + '...';
    return `
        <div class="${kind}" id="${kind}-${id}" data-full="${safe}" data-short="${short}" data-expanded="false">${short}</div>
        <button class="more-link" onclick="toggleMore('${kind}-${id}')">More Info</button>
    `;
}

function applyFeedSearch() {
    const q = ($('feedSearch').value || '').trim().toLowerCase();
    const feed = $('communityFeed');
    if (!allPosts.length) return;

    const filtered = !q ? allPosts : allPosts.filter(p => {
        const hay = [
            p.content || '',
            p.full_name || '',
            p.primary_crop || '',
            p.district || '',
            p.category || ''
        ].join(' ').toLowerCase();
        return hay.includes(q);
    });

    if (!filtered.length) {
        feed.innerHTML = `<div class="post-card" style="text-align:center; color: var(--ink-low);">No posts match your search.</div>`;
        return;
    }

    feed.innerHTML = filtered.map(renderPost).join('');
}

function renderPost(post) {
    const initials = post.full_name.split(' ').map(n => n[0]).join('').slice(0, 2);
    const author = post.full_name;
    const time = new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const hasLiked = post.has_liked ? 'active' : '';
    const user = JSON.parse(localStorage.getItem('fm_user') || '{}');
    const isOwner = user.id === post.user_id;
    const mediaItems = normalizeMedia(post);
    const mediaHtml = mediaItems.length ? `
        <div class="post-media-grid">
            ${mediaItems.map(src => src.startsWith('data:video/')
            ? `<video src="${src}" controls preload="metadata"></video>`
            : `<img src="${src}" class="post-img" loading="lazy">`).join('')}
        </div>` : '';
    const deleteBtn = isOwner ? `
        <button class="delete-trigger" onclick="openEditPost(${post.id})" title="Edit post" style="opacity:1; margin-right:8px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
        <button class="delete-trigger" onclick="deletePost(${post.id})" title="Delete post" style="opacity:1;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
    ` : '';

    return `
        <div class="post-card" id="post-${post.id}">
            <div class="post-u-row">
                <div class="u-avatar">${initials}</div>
                <div class="u-info">
                    <div class="u-name">${author} ${deleteBtn} <span class="u-meta">· ${time}</span></div>
                    <div class="u-meta">${post.district}</div>
                </div>
                <div class="category-tag">${post.category.toUpperCase()}</div>
            </div>
            ${renderExpandableText(post.content, 'post-body', post.id, 240)}
            ${mediaHtml}
            <div class="post-actions">
                <button class="action-btn ${hasLiked}" onclick="likePost(${post.id})">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                    Like (${post.like_count})
                </button>
                <button class="action-btn" onclick="toggleComments(${post.id})">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                    Comments (${post.comment_count})
                </button>
            </div>
            <div id="comments-${post.id}" class="comments-section" style="display:none;">
                <div id="comment-list-${post.id}"></div>
                <div class="c-input-wrap">
                    <input type="text" class="c-input" id="input-${post.id}" placeholder="Add a comment...">
                    <button class="action-btn" onclick="postComment(${post.id})">Post</button>
                </div>
            </div>
        </div>
    `;
}

async function deletePost(id) {
    if (!confirm('Are you sure you want to delete this post?')) return;
    try {
        const res = await authFetch(`/api/community/posts/${id}`, { method: 'DELETE' });
        if (res.ok) {
            loadPosts();
            loadStats();
        }
    } catch (e) { }
}

function toggleMore(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const btn = el.nextElementSibling;
    const expanded = el.dataset.expanded === 'true';
    el.innerHTML = expanded ? el.dataset.short : el.dataset.full;
    el.dataset.expanded = expanded ? 'false' : 'true';
    if (btn && btn.classList.contains('more-link')) btn.textContent = expanded ? 'More Info' : 'Less';
}

async function openEditPost(id) {
    const post = allPosts.find(p => p.id === id);
    if (!post) return;
    const newContent = prompt('Edit post content:', post.content || '');
    if (newContent === null) return;
    const content = newContent.trim();
    if (!content) return;
    try {
        const res = await authFetch(`/api/community/posts/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content,
                category: post.category,
                media_urls: normalizeMedia(post)
            })
        });
        if (res.ok) loadPosts();
    } catch (e) { }
}

async function likePost(id) {
    try {
        const res = await authFetch(`/api/community/posts/${id}/like`, { method: 'POST' });
        if (res.ok) loadPosts();
    } catch (e) { }
}

async function toggleComments(id) {
    const sect = $(`comments-${id}`);
    if (sect.style.display === 'none') {
        sect.style.display = 'block';
        loadComments(id);
    } else {
        sect.style.display = 'none';
    }
}

async function loadComments(id) {
    const list = $(`comment-list-${id}`);
    try {
        const res = await authFetch(`/api/community/posts/${id}/comments`);
        const comments = await res.json();
        list.innerHTML = comments.map(c => `
            <div class="comment">
                <span class="c-author">${c.full_name}</span>
                ${renderExpandableText(c.content, 'c-text', `c-${c.id}`, 140)}
            </div>
        `).join('');
    } catch (e) { }
}

async function postComment(id) {
    const input = $(`input-${id}`);
    const content = input.value.trim();
    if (!content) return;
    try {
        const res = await authFetch(`/api/community/posts/${id}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        if (res.ok) {
            input.value = '';
            loadComments(id);
            // Optionally update comment count in UI without full reload
        }
    } catch (e) { }
}

