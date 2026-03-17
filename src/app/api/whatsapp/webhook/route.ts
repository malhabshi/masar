import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';

/**
 * @fileOverview WhatsApp Webhook Receiver
 * Handles incoming POST requests from WANotifier for status updates or incoming messages.
 */

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    console.log('✅ WhatsApp Webhook Received:', data);

    // Log the event to Firestore for tracking delivery status or troubleshooting
    if (adminDb) {
      await adminDb.collection('whatsapp_logs').add({
        receivedAt: new Date().toISOString(),
        payload: data,
        type: data.event || 'unknown'
      });
    }

    return NextResponse.json({ success: true, message: 'Webhook processed' });
  } catch (error: any) {
    console.error('❌ WhatsApp Webhook Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Simple health check for the webhook endpoint
  return NextResponse.json({ 
    status: 'active', 
    service: 'Masar WhatsApp Gateway',
    timestamp: new Date().toISOString()
  });
}
