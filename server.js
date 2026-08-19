require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 5000;

const BUCKET_NAME = 'my_note_pro';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_KEY in environment variables!");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(__dirname));

// Helper: Supabase Upload
async function uploadToSupabase(fileBuffer, originalName, mimeType) {
    const ext = path.extname(originalName) || '.bin';
    const fileName = `uploads/${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;

    const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(fileName, fileBuffer, {
            contentType: mimeType,
            upsert: true
        });

    if (error) throw error;

    const { data: publicData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(fileName);

    return { url: publicData.publicUrl, filename: originalName, fileType: mimeType };
}

// 1. Single & Multiple Media Upload API
app.post('/api/upload', upload.array('media', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "No files uploaded" });
        }

        const uploadPromises = req.files.map(file => 
            uploadToSupabase(file.buffer, file.originalname, file.mimetype)
        );

        const results = await Promise.all(uploadPromises);

        if (results.length === 1) {
            return res.json(results[0]);
        }
        res.json({ files: results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. RAW CODE TO HTML FILE SUPABASE STORE API
app.post('/api/upload-code', async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ error: "Code content is empty" });

        const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>body { margin: 0; padding: 10px; font-family: sans-serif; }</style>
</head>
<body>
${code}
</body>
</html>`;

        const buffer = Buffer.from(fullHTML, 'utf-8');
        const fileResult = await uploadToSupabase(buffer, 'code_preview.html', 'text/html');

        res.json({ url: fileResult.url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Profile APIs
app.get('/api/profile', async (req, res) => {
    try {
        const { deviceId } = req.query;
        if (!deviceId) return res.status(400).json({ error: "Device ID required" });

        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('device_id', deviceId)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') throw error;
        
        if (!data) {
            const { data: newProfile, error: createError } = await supabase
                .from('profiles')
                .insert([{ 
                    device_id: deviceId,
                    name: "Note Author", 
                    img: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80" 
                }])
                .select()
                .single();
            if (createError) throw createError;
            return res.json(newProfile);
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/profile', async (req, res) => {
    try {
        const { deviceId, name, img } = req.body;
        if (!deviceId) return res.status(400).json({ error: "Device ID required" });

        const { data: existing } = await supabase
            .from('profiles')
            .select('id')
            .eq('device_id', deviceId)
            .maybeSingle();

        let result;
        const updatePayload = { device_id: deviceId };
        if (name !== undefined) updatePayload.name = name;
        if (img !== undefined) updatePayload.img = img;

        if (existing) {
            const { data, error } = await supabase
                .from('profiles')
                .update(updatePayload)
                .eq('id', existing.id)
                .select()
                .single();
            if (error) throw error;
            result = data;
        } else {
            const { data, error } = await supabase
                .from('profiles')
                .insert([{ 
                    ...updatePayload, 
                    name: name || "Note Author",
                    img: img || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80"
                }])
                .select()
                .single();
            if (error) throw error;
            result = data;
        }

        res.json({ message: "Profile updated successfully", profile: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Subjects APIs
app.get('/api/subjects', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('subjects')
            .select('*')
            .order('id', { ascending: false });

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/subjects', async (req, res) => {
    try {
        const { name, img } = req.body;
        if (!name) return res.status(400).json({ error: "Subject name is required" });

        const { data: existing } = await supabase
            .from('subjects')
            .select('id')
            .ilike('name', name)
            .maybeSingle();

        if (existing) {
            return res.status(400).json({ error: "Circle logo with this name already exists!" });
        }

        const { data, error } = await supabase
            .from('subjects')
            .insert([{
                name: name,
                img: img || "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=120&120&q=80"
            }])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/subjects/:id', async (req, res) => {
    try {
        const { error } = await supabase
            .from('subjects')
            .delete()
            .eq('id', req.params.id);

        if (error) throw error;
        res.json({ message: "Subject deleted successfully", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Notes CRUD & Analytics APIs
app.get('/api/notes', async (req, res) => {
    try {
        const { page = 1, limit = 9, search = '', subject = '', date = '', deviceId = '' } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const from = (pageNum - 1) * limitNum;
        const to = from + limitNum - 1;

        let query = supabase.from('notes').select('*', { count: 'exact' });

        if (search) {
            query = query.or(`title.ilike.%${search}%,content.ilike.%${search}%`);
        }
        if (subject) {
            query = query.ilike('subject', subject);
        }
        if (date) {
            query = query.ilike('created_at_formatted', `%${date}%`);
        }

        query = query.order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).range(from, to);

        const { data, error, count } = await query;

        if (error) throw error;

        const formattedNotes = (data || []).map(note => ({
            _id: note.id,
            title: note.title,
            content: note.content,
            subject: note.subject,
            userProfilePic: note.user_profile_pic,
            authorDeviceId: note.author_device_id,
            isPrivate: note.is_private,
            isPinned: note.is_pinned,
            likes: note.likes || 0,
            views: note.views || 0,
            userLiked: (note.liked_by || []).includes(deviceId),
            createdAtFormatted: note.created_at_formatted,
            createdAt: note.created_at
        }));

        res.json({
            notes: formattedNotes,
            total: count || 0,
            page: pageNum,
            hasMore: (from + formattedNotes.length) < count
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/notes', async (req, res) => {
    try {
        const { title, content, subject, userProfilePic, authorDeviceId, isPrivate, isPinned, createdAt } = req.body;

        const { data, error } = await supabase
            .from('notes')
            .insert([{
                title: title || 'Untitled Note',
                content: content || '',
                subject: subject || 'General',
                user_profile_pic: userProfilePic,
                author_device_id: authorDeviceId,
                is_private: !!isPrivate,
                is_pinned: !!isPinned,
                created_at_formatted: createdAt
            }])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/notes/:id', async (req, res) => {
    try {
        const { title, content, subject, userProfilePic, isPrivate, isPinned } = req.body;

        const { data, error } = await supabase
            .from('notes')
            .update({
                title,
                content,
                subject,
                user_profile_pic: userProfilePic,
                is_private: isPrivate,
                is_pinned: isPinned
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/notes/:id', async (req, res) => {
    try {
        const { error } = await supabase
            .from('notes')
            .delete()
            .eq('id', req.params.id);

        if (error) throw error;
        res.json({ message: "Note deleted successfully", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/notes/:id/like', async (req, res) => {
    try {
        const { deviceId } = req.body;
        if (!deviceId) return res.status(400).json({ error: "Device ID required" });

        const { data: note, error: fetchErr } = await supabase
            .from('notes')
            .select('likes, liked_by')
            .eq('id', req.params.id)
            .single();

        if (fetchErr) throw fetchErr;

        let likedBy = note.liked_by || [];
        let likes = note.likes || 0;
        let isLiked = false;

        if (likedBy.includes(deviceId)) {
            likedBy = likedBy.filter(id => id !== deviceId);
            likes = Math.max(0, likes - 1);
        } else {
            likedBy.push(deviceId);
            likes += 1;
            isLiked = true;
        }

        const { data: updated, error: updateErr } = await supabase
            .from('notes')
            .update({ likes, liked_by: likedBy })
            .eq('id', req.params.id)
            .select()
            .single();

        if (updateErr) throw updateErr;

        res.json({ likes: updated.likes, userLiked: isLiked });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/notes/:id/view', async (req, res) => {
    try {
        const { data: note, error: fetchErr } = await supabase
            .from('notes')
            .select('views')
            .eq('id', req.params.id)
            .single();

        if (fetchErr) throw fetchErr;

        const views = (note.views || 0) + 1;

        const { data: updated, error: updateErr } = await supabase
            .from('notes')
            .update({ views })
            .eq('id', req.params.id)
            .select()
            .single();

        if (updateErr) throw updateErr;

        res.json({ views: updated.views });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
