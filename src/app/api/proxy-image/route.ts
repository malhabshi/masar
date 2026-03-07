
import { NextRequest, NextResponse } from 'next/server';

/**
 * @fileOverview Server-side image proxy to bypass CORS restrictions for PDF generation.
 * Fetches an external image and returns it as a Base64 data URI.
 */

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'URL parameter is required' }, { status: 400 });
  }

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch image');

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/png';
    const base64 = Buffer.from(buffer).toString('base64');

    return new NextResponse(`data:${contentType};base64,${base64}`, {
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error: any) {
    console.error('Proxy Image Error:', error);
    return NextResponse.json({ error: 'Failed to proxy image' }, { status: 500 });
  }
}
