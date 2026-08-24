const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://supabase.agrolara.dedyn.io';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc4MDk4MDE4MCwiZXhwIjo0OTM2NjUzNzgwLCJyb2xlIjoiYW5vbiJ9.iejQ436gpvOWQq5clGjhq-lZdkXN593b9pSNEh70Jq8';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Agro1280@';
const JWT_SECRET = process.env.JWT_SECRET || 'agro1280_master_secret_2026_key';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware de autenticación
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'No autorizado. Inicia sesión.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Sesión expirada o token inválido.' });
  }
}

// 1. LOGIN
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Contraseña incorrecta.' });
  }

  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '15d' });
  return res.json({ success: true, token });
});

// 2. OBTENER TODAS LAS LICENCIAS Y ESTADÍSTICAS
app.get('/api/licenses', requireAuth, async (req, res) => {
  try {
    const { data: licenses, error } = await supabase
      .from('licenses')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const now = new Date();
    const enriched = (licenses || []).map(lic => {
      const expiry = lic.expires_at ? new Date(lic.expires_at) : null;
      let isExpired = false;
      let daysRemaining = 0;

      if (expiry) {
        const diffMs = expiry.getTime() - now.getTime();
        daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        isExpired = daysRemaining <= 0;
      }

      return {
        ...lic,
        isExpired,
        daysRemaining: Math.max(0, daysRemaining),
        isLockedToPc: Boolean(lic.hwid)
      };
    });

    const stats = {
      total: enriched.length,
      active: enriched.filter(l => l.status === 'active' && !l.isExpired).length,
      expiringSoon: enriched.filter(l => l.status === 'active' && !l.isExpired && l.daysRemaining <= 5).length,
      expired: enriched.filter(l => l.isExpired || l.status === 'expired').length,
      suspended: enriched.filter(l => l.status === 'suspended').length
    };

    return res.json({ success: true, stats, licenses: enriched });
  } catch (err) {
    console.error('[API] Error al listar licencias:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. CREAR NUEVA LICENCIA
app.post('/api/licenses/create', requireAuth, async (req, res) => {
  try {
    const { email, days = 30, customKey } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Ingresa un correo electrónico válido.' });
    }

    // Generar clave aleatoria limpia tipo PRO-FB-XXXX-YYYY si no se especifica
    const randomPart1 = Math.random().toString(36).substring(2, 6).toUpperCase();
    const randomPart2 = Math.random().toString(36).substring(2, 6).toUpperCase();
    const licenseKey = customKey && customKey.trim() ? customKey.trim() : `PRO-FB-${randomPart1}-${randomPart2}`;

    const numDays = parseInt(days) || 30;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + numDays);

    const { data, error } = await supabase
      .from('licenses')
      .insert([
        {
          email: email.trim().toLowerCase(),
          license_key: licenseKey,
          status: 'active',
          expires_at: expiresAt.toISOString()
        }
      ])
      .select()
      .single();

    if (error) throw error;

    return res.json({ success: true, license: data });
  } catch (err) {
    console.error('[API] Error creando licencia:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. RENOVAR LICENCIA (+30 Días o personalizado)
app.post('/api/licenses/renew', requireAuth, async (req, res) => {
  try {
    const { id, days = 30 } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'ID de licencia requerido.' });

    // Obtener fecha actual de la licencia
    const { data: existing, error: fetchErr } = await supabase
      .from('licenses')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) throw new Error('Licencia no encontrada');

    const numDays = parseInt(days) || 30;
    const now = new Date();
    const currentExpiry = existing.expires_at ? new Date(existing.expires_at) : now;

    // Si ya expiró, sumar desde hoy. Si sigue activa, sumar a la fecha restante.
    const baseDate = currentExpiry > now ? currentExpiry : now;
    baseDate.setDate(baseDate.getDate() + numDays);

    const { data, error } = await supabase
      .from('licenses')
      .update({
        expires_at: baseDate.toISOString(),
        status: 'active',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.json({ success: true, license: data });
  } catch (err) {
    console.error('[API] Error renovando licencia:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. DESVINCULAR PC (RESET HWID)
app.post('/api/licenses/reset-hwid', requireAuth, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'ID de licencia requerido.' });

    const { data, error } = await supabase
      .from('licenses')
      .update({ hwid: null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.json({ success: true, license: data });
  } catch (err) {
    console.error('[API] Error reseteando HWID:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. ALTERNAR ESTADO (PAUSAR / ACTIVAR)
app.post('/api/licenses/toggle-status', requireAuth, async (req, res) => {
  try {
    const { id, status } = req.body;
    if (!id || !status) return res.status(400).json({ success: false, error: 'Parámetros incompletos.' });

    const { data, error } = await supabase
      .from('licenses')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.json({ success: true, license: data });
  } catch (err) {
    console.error('[API] Error cambiando estado:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 7. ELIMINAR LICENCIA
app.delete('/api/licenses/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, error: 'ID requerido.' });

    const { error } = await supabase
      .from('licenses')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.json({ success: true });
  } catch (err) {
    console.error('[API] Error eliminando licencia:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Admin Server] Panel de Administración corriendo en http://0.0.0.0:${PORT}`);
});
