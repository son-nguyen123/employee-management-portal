# Quick Start Checklist

Follow this checklist to get the Employee Management App with Firebase up and running.

## Prerequisites
- [ ] Node.js and pnpm installed
- [ ] Firebase account created at firebase.google.com
- [ ] Text editor or IDE ready

## Step 1: Firebase Project Setup (5 minutes)

- [ ] Create new Firebase project at https://console.firebase.google.com
- [ ] Go to Project Settings
- [ ] Create Web app (if not exists)
- [ ] Copy Firebase configuration

## Step 2: Configure Environment Variables (2 minutes)

- [ ] Copy `.env.local.example` to `.env.local`
- [ ] Fill in Firebase credentials from Step 1
- [ ] Save `.env.local` file

```bash
cp .env.local.example .env.local
# Edit and add your Firebase credentials
```

## Step 3: Enable Firebase Services (3 minutes)

In Firebase Console:

- [ ] Enable **Authentication** > Sign-in method > Email/Password
- [ ] Enable **Firestore Database** (Start in test mode for development)
- [ ] Enable **Cloud Storage** (for future file uploads)
- [ ] Choose your preferred region for Firestore

## Step 4: Deploy Security Rules (2 minutes)

In Firebase Console Firestore:

- [ ] Go to **Rules** tab
- [ ] Copy all content from `firestore.rules` file
- [ ] Paste into Rules editor
- [ ] Click **Publish**

## Step 5: Create Admin User (3 minutes)

In Firebase Console:

- [ ] Go to **Authentication** > **Users**
- [ ] Click **Add user**
- [ ] Enter admin email and password
- [ ] Copy the User UID

In Firestore Console:

- [ ] Create new collection named `employees`
- [ ] Create document with ID = (the User UID from above)
- [ ] Add these fields:
  ```
  uid: (User UID)
  employeeCode: ADM-001
  fullName: Admin User
  email: (admin email)
  phone: +1234567890
  role: admin
  status: active
  joinDate: (today's date)
  createdAt: (today's date)
  updatedAt: (today's date)
  ```

## Step 6: Add Sample Company Rules (2 minutes)

In Firestore Console:

- [ ] Create new collection named `companyRules`
- [ ] Add sample rules documents with fields:
  ```
  title: (Rule title)
  content: (Rule description)
  order: (1, 2, 3, etc.)
  isActive: true
  createdAt: (today's date)
  updatedAt: (today's date)
  ```

## Step 7: Start Development Server (1 minute)

```bash
# Install dependencies (if not done)
pnpm install

# Start dev server
pnpm dev
```

- [ ] Dev server running at http://localhost:3000

## Step 8: Test Authentication (3 minutes)

- [ ] Open http://localhost:3000 in browser
- [ ] You should see the employee management dashboard
- [ ] Try to sign in with admin credentials (optional - depends on your app implementation)

## Step 9: Test Firestore Connection (3 minutes)

- [ ] Check browser console for any errors
- [ ] Check Firebase Console > Firestore > Indexes for any build process
- [ ] Verify data operations are working

## Step 10: Review Documentation (5 minutes)

- [ ] Read FIREBASE_SETUP.md for detailed configuration
- [ ] Read DEVELOPER_GUIDE.md for usage examples
- [ ] Read IMPLEMENTATION_SUMMARY.md for system overview

## Common Issues & Solutions

### "Permission denied" Errors
**Solution:** 
- Verify security rules are published in Firestore
- Check user role is correctly set in employees collection
- Wait a moment for rules to propagate

### Can't connect to Firebase
**Solution:**
- Verify `.env.local` has correct credentials
- Check that services are enabled in Firebase Console
- Restart dev server

### Firestore operations not working
**Solution:**
- Verify Firestore database is created
- Check that collections exist
- Review security rules for read/write permissions
- Check browser console for detailed error messages

### Still can't get it working?
- Clear browser cache and cookies
- Restart dev server (`pnpm dev`)
- Check that all environment variables are set
- Review error messages in Firebase Console

## Next Steps

1. **Update App UI**
   - Update pages to use Firebase services
   - Implement authentication UI
   - Add form validations

2. **Add More Features**
   - Implement approval workflows
   - Add notification system
   - Create admin dashboard

3. **Prepare for Production**
   - Switch Firestore to production mode
   - Update security rules for production
   - Enable backups
   - Set up monitoring

4. **Deploy**
   - Deploy to Vercel (recommended)
   - Update Firebase allowed domains
   - Configure environment variables in hosting platform

## File Structure Overview

```
project/
├── lib/
│   ├── firebase.ts                    # Firebase init
│   ├── models/
│   │   ├── types.ts                  # TypeScript interfaces
│   │   └── index.ts                  # Type exports
│   ├── services/
│   │   ├── authService.ts            # Auth functions
│   │   ├── employeeService.ts        # Employee functions
│   │   ├── scheduleService.ts        # Schedule functions
│   │   ├── leaveService.ts           # Leave functions
│   │   ├── lateService.ts            # Late request functions
│   │   ├── salaryService.ts          # Salary advance functions
│   │   ├── penaltyService.ts         # Penalty functions
│   │   ├── rulesService.ts           # Rules functions
│   │   ├── notificationService.ts    # Notification functions
│   │   └── index.ts                  # Service exports
│   └── hooks/
│       └── useAuth.ts                # Auth hook & context
├── firestore.rules                    # Security rules
├── .env.local.example                 # Env template
├── FIREBASE_SETUP.md                  # Setup guide
├── DEVELOPER_GUIDE.md                 # Developer guide
├── IMPLEMENTATION_SUMMARY.md          # System overview
└── QUICK_START.md                     # This file
```

## Key Commands

```bash
# Start dev server
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start

# Lint code
pnpm lint
```

## Useful Links

- Firebase Console: https://console.firebase.google.com
- Firebase Documentation: https://firebase.google.com/docs
- Firestore Best Practices: https://firebase.google.com/docs/firestore/best-practices
- Next.js Documentation: https://nextjs.org/docs

## Security Checklist

Before going to production:

- [ ] Update security rules from test mode to production
- [ ] Enable multi-factor authentication for admin accounts
- [ ] Review and test all security rules
- [ ] Set up Firestore backups
- [ ] Monitor Firestore usage and set alerts
- [ ] Review and limit API keys in Firebase Console
- [ ] Set up Cloud Audit Logs
- [ ] Document access control policies

## Support

- Check the documentation files in the project
- Review error messages in Firebase Console
- Check browser console for client-side errors
- Refer to Firebase official documentation

---

**Estimated total time: ~30 minutes**

Once you complete these steps, your Employee Management App will be fully functional with Firebase backend!
