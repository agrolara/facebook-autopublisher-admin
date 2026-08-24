const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://supabase.agrolara.dedyn.io';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc4MDk4MDE4MCwiZXhwIjo0OTM2NjUzNzgwLCJyb2xlIjoiYW5vbiJ9.iejQ436gpvOWQq5clGjhq-lZdkXN593b9pSNEh70Jq8';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Agro1280@';
const JWT_SECRET = process.env.JWT_SECRET || 'agro1280_master_secret_2026_key';

const CACHE_FILE = path.join(__dirname, 'licenses_cache.json');

// Inicializar Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

// Cargar o inicializar caché local
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[Cache] Error leyendo cache:', e.message);
  }
  return [
    {
      id: 'demo-1',
      email: 'demo@antigravity.pro',
      license_key: 'DEMO-PRO-2026-KEY',
      hwid: '9e3e9b86-23d1-44e4-ad69-b8a49b1b0344',
      status: 'active',
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString()
    },
    {
      id: 'mat-1',
      email: 'materiales.integrity@gmail.com',
      license_key: 'Agro1280@',
      hwid: null,
      status: 'active',
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString()
    }
  ];
}

function saveCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[Cache] Error guardando cache:', e.message);
  }
}

let licensesMemory = loadCache();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check para Coolify / Docker
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

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
    const now = new Date();
    const enriched = licensesMemory.map(lic => {
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

    const cleanEmail = email.trim().toLowerCase();
    const randomPart1 = Math.random().toString(36).substring(2, 6).toUpperCase();
    const randomPart2 = Math.random().toString(36).substring(2, 6).toUpperCase();
    const licenseKey = customKey && customKey.trim() ? customKey.trim() : `PRO-FB-${randomPart1}-${randomPart2}`;
    const numDays = parseInt(days) || 30;

    // 1. Guardar en Supabase mediante RPC segura
    try {
      await supabase.rpc('admin_create_or_renew_license', {
        p_email: cleanEmail,
        p_license_key: licenseKey,
        p_days_validity: numDays
      });
    } catch (rpcErr) {
      console.warn('[Supabase RPC Warning]', rpcErr.message);
    }

    // 2. Actualizar memoria local
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + numDays);

    const existingIdx = licensesMemory.findIndex(l => l.email.toLowerCase() === cleanEmail);
    const newLicense = {
      id: existingIdx >= 0 ? licensesMemory[existingIdx].id : 'lic_' + Date.now(),
      email: cleanEmail,
      license_key: licenseKey,
      hwid: existingIdx >= 0 ? licensesMemory[existingIdx].hwid : null,
      status: 'active',
      expires_at: expiresAt.toISOString(),
      created_at: existingIdx >= 0 ? licensesMemory[existingIdx].created_at : new Date().toISOString()
    };

    if (existingIdx >= 0) {
      licensesMemory[existingIdx] = newLicense;
    } else {
      licensesMemory.unshift(newLicense);
    }

    saveCache(licensesMemory);

    return res.json({ success: true, license: newLicense });
  } catch (err) {
    console.error('[API] Error creando licencia:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. RENOVAR LICENCIA (+30 Días)
app.post('/api/licenses/renew', requireAuth, async (req, res) => {
  try {
    const { id, days = 30 } = req.body;
    const lic = licensesMemory.find(l => l.id === id);
    if (!lic) return res.status(404).json({ success: false, error: 'Licencia no encontrada' });

    const numDays = parseInt(days) || 30;

    // RPC Supabase
    try {
      await supabase.rpc('admin_create_or_renew_license', {
        p_email: lic.email,
        p_license_key: lic.license_key,
        p_days_validity: numDays
      });
    } catch (rpcErr) {
      console.warn('[Supabase RPC Warning]', rpcErr.message);
    }

    const now = new Date();
    const currentExpiry = lic.expires_at ? new Date(lic.expires_at) : now;
    const baseDate = currentExpiry > now ? currentExpiry : now;
    baseDate.setDate(baseDate.getDate() + numDays);

    lic.expires_at = baseDate.toISOString();
    lic.status = 'active';
    lic.updated_at = new Date().toISOString();

    saveCache(licensesMemory);

    return res.json({ success: true, license: lic });
  } catch (err) {
    console.error('[API] Error renovando licencia:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. DESVINCULAR PC (RESET HWID)
app.post('/api/licenses/reset-hwid', requireAuth, async (req, res) => {
  try {
    const { id } = req.body;
    const lic = licensesMemory.find(l => l.id === id);
    if (!lic) return res.status(404).json({ success: false, error: 'Licencia no encontrada' });

    // RPC Supabase
    try {
      await supabase.rpc('admin_reset_hwid', { p_email: lic.email });
    } catch (rpcErr) {
      console.warn('[Supabase RPC Warning]', rpcErr.message);
    }

    lic.hwid = null;
    lic.updated_at = new Date().toISOString();

    saveCache(licensesMemory);

    return res.json({ success: true, license: lic });
  } catch (err) {
    console.error('[API] Error reseteando HWID:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. ALTERNAR ESTADO (PAUSAR / ACTIVAR)
app.post('/api/licenses/toggle-status', requireAuth, async (req, res) => {
  try {
    const { id, status } = req.body;
    const lic = licensesMemory.find(l => l.id === id);
    if (!lic) return res.status(404).json({ success: false, error: 'Licencia no encontrada' });

    lic.status = status;
    lic.updated_at = new Date().toISOString();

    saveCache(licensesMemory);

    return res.json({ success: true, license: lic });
  } catch (err) {
    console.error('[API] Error cambiando estado:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 7. ELIMINAR LICENCIA
app.delete('/api/licenses/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    licensesMemory = licensesMemory.filter(l => l.id !== id);
    saveCache(licensesMemory);

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

// Manejo de errores globales
process.on('uncaughtException', (err) => {
  console.error('[Global Uncaught Exception]', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Global Unhandled Rejection]', reason);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Admin Server] Panel de Administración corriendo en http://0.0.0.0:${PORT}`);
});
