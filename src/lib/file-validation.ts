
export const MAX_FILE_SIZE_MB = 10;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export const ALLOWED_FILE_TYPES = [
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  
  // Documents
  "application/pdf",
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "text/plain", // .txt
];

export const ALLOWED_FILE_EXTENSIONS = ".jpg, .jpeg, .png, .gif, .webp, .pdf, .doc, .docx, .xls, .xlsx, .txt";

interface ValidationResult {
    isValid: boolean;
    message: string;
}

export function validateFile(file: File): ValidationResult {
    if (file.size > MAX_FILE_SIZE_BYTES) {
        return {
            isValid: false,
            message: `File size cannot exceed ${MAX_FILE_SIZE_MB}MB.`,
        };
    }
    
    // A simple check on MIME types. More robust validation could be added.
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
        // A more robust check could look at file extensions if type is generic like application/octet-stream
        return {
            isValid: false,
            message: `File type is not supported. Please upload one of the allowed document or image types.`,
        };
    }

    return { isValid: true, message: 'File is valid.' };
}
