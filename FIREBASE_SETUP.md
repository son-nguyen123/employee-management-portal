# Firebase Setup Guide

This document provides instructions for setting up and configuring Firebase for the Employee Management Application.

## Prerequisites

- Firebase project created (https://firebase.google.com)
- Node.js and pnpm installed
- Basic understanding of Firestore and Firebase Authentication

## Step 1: Firebase Project Configuration

### 1.1 Enable Firebase Services

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Enable the following services:
   - **Firebase Authentication** (Email/Password)
   - **Cloud Firestore** (Database)
   - **Cloud Storage** (for future file uploads)

### 1.2 Get Firebase Config

1. In Firebase Console, go to **Project Settings**
2. Under "Your apps", find or create a Web app
3. Copy the Firebase configuration
4. Create `.env.local` file in the project root (use `.env.local.example` as template)
5. Add your Firebase config values:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
```

## Step 2: Set Up Firestore Database

### 2.1 Create Firestore Database

1. Go to **Firestore Database** in Firebase Console
2. Click **Create database**
3. Choose **Start in test mode** (for development)
4. Select your preferred region
5. Click **Create**

### 2.2 Create Collections and Indexes

The following collections will be created automatically when you add data:

#### Collections Structure:
- `employees` - Employee profiles and information
- `workSchedules` - Employee work schedules
- `leaveRequests` - Leave request submissions
- `lateRequests` - Late arrival requests
- `salaryAdvances` - Salary advance requests
- `penalties` - Employee penalties
- `companyRules` - Company policies and rules
- `notifications` - Employee notifications

### 2.3 Create Composite Indexes

For optimal query performance, create these composite indexes in Firestore:

1. **workSchedules Collection:**
   - Fields: `employeeId` (Ascending), `date` (Descending)
   - Fields: `employeeId` (Ascending), `status` (Ascending)

2. **leaveRequests Collection:**
   - Fields: `employeeId` (Ascending), `leaveDate` (Descending)
   - Fields: `status` (Ascending), `createdAt` (Descending)

3. **lateRequests Collection:**
   - Fields: `employeeId` (Ascending), `date` (Descending)
   - Fields: `status` (Ascending), `createdAt` (Descending)

4. **penalties Collection:**
   - Fields: `employeeId` (Ascending), `penaltyDate` (Descending)
   - Fields: `category` (Ascending), `penaltyDate` (Descending)

5. **notifications Collection:**
   - Fields: `employeeId` (Ascending), `createdAt` (Descending)
   - Fields: `employeeId` (Ascending), `isRead` (Ascending)

## Step 3: Configure Security Rules

### 3.1 Deploy Firestore Security Rules

1. In Firebase Console, go to **Firestore Database** > **Rules**
2. Copy the contents from `firestore.rules` file
3. Paste into the Rules editor
4. Click **Publish**

### Rules Summary:

- **Employees:** Can only read/update their own profiles
- **Admins:** Can manage all collections
- **Managers:** Can approve/reject requests and manage employee data
- **Employees:** Can create requests and view their own data
- **Public:** Can read active company rules

## Step 4: Set Up Authentication

### 4.1 Enable Email/Password Authentication

1. Go to **Authentication** in Firebase Console
2. Click **Sign-in method**
3. Enable **Email/Password**
4. Click **Save**

### 4.2 Create Admin Account

1. In Firebase Console, go to **Authentication** > **Users**
2. Click **Add user**
3. Enter admin email and password
4. Create the corresponding employee document in Firestore with `role: 'admin'`

## Step 5: Create Initial Data

### 5.1 Create Admin Employee Document

Navigate to Firestore and manually create an admin employee document:

Collection: `employees`
Document ID: (Use the Firebase auth UID of the admin user)

```json
{
  "uid": "firebase_auth_uid",
  "employeeCode": "ADM-001",
  "fullName": "Admin User",
  "phone": "+1234567890",
  "email": "admin@example.com",
  "role": "admin",
  "status": "active",
  "joinDate": "2024-01-01",
  "createdAt": "2024-01-01",
  "updatedAt": "2024-01-01"
}
```

### 5.2 Add Company Rules

Create documents in the `companyRules` collection:

```json
{
  "title": "Punctuality",
  "content": "Employees are expected to arrive on time...",
  "order": 1,
  "isActive": true,
  "createdAt": "2024-01-01",
  "updatedAt": "2024-01-01"
}
```

## Step 6: Testing the Setup

### 6.1 Test Firebase Connection

Run the development server:

```bash
pnpm dev
```

### 6.2 Test Authentication

1. Navigate to your app (http://localhost:3000)
2. Test signing up/signing in with email and password
3. Verify user data is saved in Firestore `employees` collection

### 6.3 Test Data Operations

Test creating different types of requests to ensure Firestore is properly configured:
- Create a work schedule
- Submit a leave request
- Submit a late arrival request
- Submit a salary advance request

## Step 7: Environment for Production

For production deployment:

1. Switch Firestore to **Production Mode** security rules
2. Update `.env.local` with production Firebase config
3. Set up proper authentication (consider adding Google/social login)
4. Enable backups for Firestore
5. Set up Firestore billing alerts
6. Configure Cloud Storage lifecycle policies

## Database Relationships

```
employees (1)
├── workSchedules (N)
├── leaveRequests (N)
├── lateRequests (N)
├── salaryAdvances (N)
├── penalties (N)
└── notifications (N)

lateRequests → workSchedules
leaveRequests → workSchedules (optional)
```

## Important Notes

### Firestore Costs

- Read: 1 document read = 1 read operation
- Write: 1 document write = 1 write operation
- Delete: 1 document delete = 1 write operation
- Monitor usage in Firebase Console

### Best Practices

1. **Indexes:** Firestore will suggest indexes. Create them for better query performance
2. **Timestamps:** Always use `Timestamp.now()` for server-side timestamps
3. **Security:** Review and test security rules thoroughly
4. **Backup:** Enable automated backups in Firestore settings
5. **Pagination:** Implement pagination for large datasets to reduce read costs

### Common Issues

**Issue:** "Permission denied" errors
- **Solution:** Verify security rules are correctly deployed and user has proper role

**Issue:** Queries not returning results
- **Solution:** Check composite indexes are created for the query pattern

**Issue:** Slow queries
- **Solution:** Create appropriate composite indexes for common query patterns

## Useful Resources

- [Firestore Documentation](https://firebase.google.com/docs/firestore)
- [Firebase Security Rules](https://firebase.google.com/docs/rules)
- [Firestore Best Practices](https://firebase.google.com/docs/firestore/best-practices)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)

## Support

For issues or questions:
1. Check Firebase Console logs
2. Review Firestore security rules
3. Check browser console for errors
4. Verify environment variables are correctly set
