const API_BASE_URL = 'https://my-note-pro-1.onrender.com/api';

// 1. Fetch All Notes from Server
async function loadNotesFromDB() {
    try {
        const res = await fetch(`${API_BASE_URL}/notes`);
        const result = await res.json();
        return result.data || [];
    } catch (err) {
        console.error('Error fetching notes:', err);
        return [];
    }
}

// 2. Save / Auto-Save Note to Server
async function saveNoteToDB(noteObj) {
    try {
        const res = await fetch(`${API_BASE_URL}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(noteObj)
        });
        return await res.json();
    } catch (err) {
        console.error('Error saving note:', err);
    }
}

// 3. Delete Note from Server
async function deleteNoteFromDB(id) {
    try {
        const res = await fetch(`${API_BASE_URL}/notes/${id}`, {
            method: 'DELETE'
        });
        return await res.json();
    } catch (err) {
        console.error('Error deleting note:', err);
    }
}

// 4. Save Setting
async function saveSettingToDB(key, value) {
    try {
        const res = await fetch(`${API_BASE_URL}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value })
        });
        return await res.json();
    } catch (err) {
        console.error('Error saving setting:', err);
    }
}

// 5. Get Setting
async function getSettingFromDB(key) {
    try {
        const res = await fetch(`${API_BASE_URL}/settings/${key}`);
        const result = await res.json();
        return result.data;
    } catch (err) {
        console.error('Error fetching setting:', err);
        return null;
    }
}
