
/**
 * Defines the types of notifications that can be sent.
 * Each type corresponds to a specific WhatsApp template and webhook URL.
 */
export enum NotificationType {
  // A generic notification for testing or simple messages.
  // Template: "HI {{1}} PLEASE FIND A NEW NOTIFICATION"
  GENERIC_NOTIFICATION = 'GENERIC_NOTIFICATION',
  
  // Sent to an admin when an employee uploads a document.
  // Template: "Hi {{1}}, employee {{2}} has uploaded a new document ('{{3}}') for student {{4}}."
  DOCUMENT_UPLOAD_TO_ADMIN = 'DOCUMENT_UPLOAD_TO_ADMIN',

  // Sent to an employee when an admin uploads a document for their student.
  // Template: "Hi {{1}}, a new document ('{{2}}') has been uploaded for your student, {{3}}."
  DOCUMENT_UPLOAD_TO_EMPLOYEE = 'DOCUMENT_UPLOAD_TO_EMPLOYEE',

  // Sent to an admin when a new Jotform is submitted.
  // Template: "A new student submission has been received from Jotform for '{{1}}'. Please check your email for the full details and add them to the system."
  JOTFORM_SUBMISSION = 'JOTFORM_SUBMISSION',
}

/**
 * Retrieves the appropriate Webhook URL from environment variables based on the notification type.
 * @param type The type of the notification.
 * @returns The webhook URL string, or undefined if not set.
 */
function getWebhookUrl(type: NotificationType): string | undefined {
  switch (type) {
    case NotificationType.GENERIC_NOTIFICATION:
      // This uses the primary webhook URL, used for testing and general notices.
      return process.env.WANOTIFIER_WEBHOOK_URL;
    
    case NotificationType.DOCUMENT_UPLOAD_TO_ADMIN:
      // IMPORTANT: You must set this environment variable with the specific webhook URL for this template.
      return process.env.WANOTIFIER_DOC_UPLOAD_ADMIN_URL || process.env.WANOTIFIER_WEBHOOK_URL;
      
    case NotificationType.DOCUMENT_UPLOAD_TO_EMPLOYEE:
      // IMPORTANT: You must set this environment variable with the specific webhook URL for this template.
      return process.env.WANOTIFIER_DOC_UPLOAD_EMPLOYEE_URL || process.env.WANOTIFIER_WEBHOOK_URL;
      
    case NotificationType.JOTFORM_SUBMISSION:
      // IMPORTANT: You must set this environment variable with the specific webhook URL for this template.
      return process.env.WANOTIFIER_JOTFORM_URL || process.env.WANOTIFIER_WEBHOOK_URL;

    default:
      // Fallback to the main webhook URL if a specific one isn't found.
      return process.env.WANOTIFIER_WEBHOOK_URL;
  }
}

/**
 * Sends a generic WhatsApp message by calling a webhook.
 * This is the base function for sending notifications.
 * @param webhookUrl The full URL of the webhook to call.
 * @param to The recipient's full phone number (e.g., 96512345678).
 * @param data A key-value object for the template variables.
 * @returns The result of the send operation.
 */
export async function sendWhatsAppMessage(webhookUrl: string, to: string, data: Record<string, string>) {
  const sanitizedTo = to.replace(/\D/g, '');
  console.log(`Sending WhatsApp notification to ${sanitizedTo} with data:`, data);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10-second timeout

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: sanitizedTo, data: data }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
       const errorBody = await response.text();
       console.error('Failed to send WhatsApp message. API responded with:', errorBody);
       return { success: false, message: `The notification service returned an error. Details: ${errorBody}` };
    }
    console.log('WhatsApp message sent successfully.');
    return { success: true, message: 'WhatsApp notification sent successfully.' };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error('WhatsApp message request timed out.');
      return { success: false, message: 'The request to the notification service timed out. Please check network connectivity.' };
    }
    console.error('Error sending WhatsApp message:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, message: `An unexpected error occurred while trying to send the message: ${errorMessage}` };
  }
}

/**
 * Sends a pre-defined, typed WhatsApp message.
 * This function looks up the correct webhook URL and sends the provided data.
 * 
 * @param type The type of notification to send.
 * @param to The recipient's full phone number (e.g., 96512345678).
 * @param data A key-value object for the template variables (e.g., { "1": "value1", "2": "value2" }).
 * @returns The result of the send operation.
 */
export async function sendTypedWhatsAppMessage(
  type: NotificationType, 
  to: string, 
  data: Record<string, string> 
) {
  const webhookUrl = getWebhookUrl(type);
  if (!webhookUrl) {
    const errorMessage = `Webhook URL for notification type '${type}' is not configured in your environment variables.`;
    console.error(errorMessage);
    return { success: false, message: errorMessage };
  }
  
  return await sendWhatsAppMessage(webhookUrl, to, data);
}
