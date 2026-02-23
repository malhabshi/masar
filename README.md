# UniApply Hub: Comprehensive Application Management System

## 1. Project Overview

UniApply Hub is a web-based platform designed for educational agencies to manage the university application process for students. It provides a collaborative environment for different user roles (admins, employees, and departments) to track student progress, manage applications, handle documentation, and communicate effectively.

The system is built on a modern tech stack including Next.js, React, TypeScript, and Firebase (for database, authentication, and security).

---

## 2. User Roles & Permissions

The application has three distinct user roles, each with specific permissions:

### a. Admin (`admin`)
The superuser with full control over the entire system.
- **Can do everything an Employee and Department can.**
- **User Management:** Create, edit, and manage user accounts and their roles. Can perform bulk student transfers between employees.
- **System Configuration:** Customize the application's appearance (theme, logo), and manage global settings like approved universities and application questions.
- **Full Data Access:** Has read/write access to all student profiles, applications, documents, and chats.
- **Reporting:** Can view department-wide performance reports and employee activity logs.

### b. Employee (`employee`)
The primary agent responsible for managing a portfolio of students.
- **Student Management:** Can create new student profiles, which are automatically assigned to them.
- **Application Management:** Can add new university applications for their assigned students and track their status.
- **Document Handling:** Can upload and manage documents for their students.
- **Communication:** Can initiate chats with admins regarding a specific student and submit requests (e.g., transfer a student, report inactivity).
- **Limited Data Access:** Can only view and edit the profiles of students who are directly assigned to them.

### c. Department (`department`)
A specialized role, often for internal review or management, with broader read access than an employee.
- **View All Students:** Can view the profiles and applications of all students in the system.
- **Status Updates:** Can update the status of any student's university application.
- **Communication:** Can participate in the internal chat system.
- **No User Management:** Cannot create or manage user accounts.

---

## 3. Core Features

### a. Student & Application Management
- **Dashboard:** A central landing page showing key statistics (e.g., total students, pending applications) and a feed of recent tasks and notifications.
- **Applicants List:** A comprehensive, filterable list of all students. Admins and Departments see all students, while Employees only see their assigned students. Filters include pipeline status, assigned employee, IELTS score, and academic term.
- **Student Profile:** A detailed view for each student, including:
  - Personal information and contact details.
  - A list of all university applications, their statuses, and the final university choice.
  - A profile completion checklist to track progress towards being "Ready to Travel."
  - Sections for managing documents, notes, and missing items.
- **Unassigned Students:** A dedicated view for admins to see newly created students and assign them to an employee.
- **Finalized Students:** A view to see all students who have made their final university choice, with filtering options.

### b. Communication & Tasking
- **Internal Chat:** A real-time chat feature embedded within each student's profile, allowing an Employee and an Admin/Department to discuss that specific student's case.
- **Task Management:** Admins can send tasks and updates to all employees or specific users. These appear on the recipient's dashboard. Employees can reply to tasks.
- **Request System:** Employees can submit predefined requests for a student (e.g., "Request Transfer") which create tasks for the admin.

### c. Document & Resource Management
- **Student Documents:** Documents can be uploaded to a student's profile, with separate sections for employee-uploaded and admin-uploaded files. New uploads trigger notifications.
- **Shared Resources:** Admins can maintain a global list of shared documents (e.g., company policies) and helpful links (e.g., official admissions websites) accessible to all users.

### d. Admin-Specific Features
- **User Management:** A dedicated page to create new user accounts and change the roles of existing users.
- **Bulk Transfer:** A tool to transfer all students from one employee to another, useful for off-boarding.
- **Activity Reports:** A reporting dashboard showing daily and monthly employee activity (e.g., time logged, tasks sent, profiles visited) and department-wide performance metrics.
- **Application Questions:** A page where admins can manage the questions for the new student application form.
- **System Settings:** A page to customize the application's theme colors and upload a custom logo.

---

## 4. Technical Architecture

- **Frontend:** Next.js with the App Router, React, TypeScript, and Tailwind CSS for styling with shadcn/ui components.
- **Backend & Database:** Firebase is used for:
  - **Firestore:** A NoSQL database for storing all application data (users, students, applications, etc.).
  - **Firebase Authentication:** Handles user sign-up, login, and session management.
  - **Firestore Security Rules:** Provides granular, server-side enforcement of user permissions.

### Firestore Data Model
The database is structured around several key collections:
- `/users/{userId}`: Stores public profiles for all users, including their role.
- `/students/{studentId}`: Stores all information for each student.
- `/employees/{employeeId}/students/{studentId}`: A mapping collection that grants an employee permission to access a specific student. This is the foundation of the security model.
- `/tasks/{taskId}`: Stores all tasks and their replies.
- `/chats/{studentId}/messages/{messageId}`: Stores chat messages, nested under the relevant student.
- Other global collections include `/approved_universities`, `/upcoming_events`, `/shared_documents`, etc.
