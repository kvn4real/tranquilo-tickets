import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

/*
  Stockage par fichier JSON local, sans dépendance externe (pas de
  Vercel Blob, pas de base de données).

  ATTENTION (important si déployé sur Vercel) :
  Le système de fichiers des fonctions serverless Vercel est éphémère :
  - seul /tmp est inscriptible, et son contenu n'est PAS garanti de
    persister entre deux requêtes (chaque requête peut atterrir sur une
    instance différente, recréée à froid sans /tmp précédent)
  - même quand ça persiste un moment, tout redéploiement repart de zéro
  Résultat : sur Vercel, attends-toi à des pertes de données occasionnelles.
  Ce mode convient bien en local (npm run dev) ou sur un serveur classique
  (VPS, conteneur avec disque persistant) où le système de fichiers est
  stable.
*/

const STATE_DIR = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), '.data');
const STATE_FILE = path.join(STATE_DIR, 'app-state.json');

async function ensureDir() {
  try {
    await fs.mkdir(STATE_DIR, { recursive: true });
  } catch (e) {
    // ignore
  }
}

function computeEtag(content) {
  return crypto.createHash('sha1').update(content).digest('hex');
}

async function readStateFile() {
  try {
    const content = await fs.readFile(STATE_FILE, 'utf8');
    return { content, etag: computeEtag(content) };
  } catch (e) {
    return null;
  }
}

export async function GET() {
  try {
    const existing = await readStateFile();
    if (!existing) {
      return NextResponse.json({ state: null, etag: null });
    }
    const data = JSON.parse(existing.content);
    return NextResponse.json({ state: data, etag: existing.etag });
  } catch (err) {
    console.error('GET /api/state error', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const { state, etag } = body;
    if (!state) {
      return NextResponse.json({ error: 'missing_state' }, { status: 400 });
    }

    await ensureDir();

    const existing = await readStateFile();
    if (etag && existing && existing.etag !== etag) {
      return NextResponse.json({ error: 'conflict' }, { status: 409 });
    }
    if (etag && !existing) {
      // un etag était attendu mais il n'y a plus de fichier (ex: /tmp vidé) :
      // on accepte quand même l'écriture plutôt que de bloquer l'utilisateur.
    }

    const content = JSON.stringify(state);
    await fs.writeFile(STATE_FILE, content, 'utf8');
    const freshEtag = computeEtag(content);

    return NextResponse.json({ ok: true, etag: freshEtag });
  } catch (err) {
    console.error('PUT /api/state error', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 500 });
  }
}
