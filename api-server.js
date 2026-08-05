// 1. Fetch Notes from Server
async function loadNotesFromDB() {
    const res = await fetch('http://localhost:5000/api/notes');
    const result = await res.json();
    return result.data || [];
}

// 2. Save / Auto-Save Note to Server
async function saveNoteToDB(noteObj) {
    await fetch('http://localhost:5000/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noteObj)
    });
}

// 3. Delete Note from Server
async function deleteNoteFromDB(id) {
    await fetch(`http://localhost:5000/api/notes/${id}`, {
        method: 'DELETE'
    });
}

// 4. Settings Save & Get
async function saveSettingToDB(key, value) {
    await fetch('http://localhost:5000/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value })
    });
}

async function getSettingFromDB(key) {
    const res = await fetch(`http://localhost:5000/api/settings/${key}`);
    const result = await res.json();
    return result.data;
}
