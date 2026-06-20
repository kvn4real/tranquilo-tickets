import { put, head } from '@vercel/blob';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const STATE_PATHNAME = 'state/app-state.json';

async function findStateBlob() {
  try {
    return await head(STATE_PATHNAME);
  } catch (e) {
    return null;
  }
}

// Détecte un conflit de précondition (ifMatch) sans dépendre d'un export
// de classe qui peut ne pas exister selon la version de @vercel/blob
// installée (c'est ce qui causait "Right-hand side of 'instanceof' is
// not an object" : BlobPreconditionFailedError était undefined).
function isPreconditionFailedError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode || err?.response?.status;
  if (status === 412) return true;
  const name = err.name || '';
  const message = err.message || '';
  return (
    name.includes('PreconditionFailed') ||
    message.includes('precondition') ||
    message.includes('Precondition') ||
    message.includes('412')
  );
}

export async function GET() {
  try {
    const existing = await findStateBlob();
    if (!existing) {
      return NextResponse.json({ state: null, etag: null });
    }
    const res = await fetch(existing.url, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ state: null, etag: null });
    }
    const data = await res.json();
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

    const putOptions = {
      access: 'public',
      contentType: 'application/json',
      allowOverwrite: true,
      addRandomSuffix: false,
    };

    if (etag) {
      putOptions.ifMatch = etag;
    }

    try {
      const result = await put(STATE_PATHNAME, JSON.stringify(state), putOptions);
      const fresh = await head(STATE_PATHNAME);
      return NextResponse.json({ ok: true, etag: fresh.etag, url: result.url });
    } catch (err) {
      if (isPreconditionFailedError(err)) {
        return NextResponse.json({ error: 'conflict' }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    console.error('PUT /api/state error', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 500 });
  }
}
