# Masar: Comprehensive Application Management System

## 1. Project Overview

Masar is a web-based platform designed for educational agencies to manage the university application process for students. It provides a collaborative environment for different user roles (admins, employees, and departments) to track student progress, manage applications, handle documentation, and communicate effectively.

The system is built on a modern tech stack including Next.js, React, TypeScript, and Firebase (for database, authentication, and security).

---

## 2. WhatsApp Integration

### Webhook Gateway
Your application includes a built-in webhook receiver to handle updates from WhatsApp (via WANotifier). This allows the system to track delivery status and potentially receive incoming messages.

**Webhook URL:** `https://[your-app-domain]/api/whatsapp/webhook`

### Notification Templates
Admins can customize exactly what messages are sent for different system events (Task assignment, status changes, etc.) via the **WA Templates** manager in the application settings.

---

## 3. User Roles & Permissions

### a. Admin (`admin`)
The superuser with full control over the entire system.
- **User Management:** Create, edit, and manage user accounts.
- **Notification Management:** Configure WhatsApp templates and gateway settings.
- **System Configuration:** Customize the application's appearance and global settings.
- **Full Data Access:** Has read/write access to all student profiles, applications, and documents.

### b. Employee (`employee`)
The primary agent responsible for managing a portfolio of students.
- **Student Management:** Can create new student profiles and manage their cases.
- **Application Management:** Track university applications and status.
- **Communication:** Chat with admins regarding specific students.

### c. Department (`department`)
Specialized internal review role.
- **View All Students:** Broader read access than an employee.
- **Status Updates:** Can update application statuses.

---

## 4. Technical Architecture

- **Frontend:** Next.js (App Router), React, Tailwind CSS, shadcn/ui.
- **Backend:** Firebase Firestore, Authentication, and Storage.
- **Notifications:** Integrated with WANotifier for automated WhatsApp alerts.
