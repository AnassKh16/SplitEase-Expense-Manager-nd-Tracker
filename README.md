<div align="center">

<br/>

# 💸 SplitEase
### *Split Smart. Settle Easy.*

<br/>

[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=white)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Oracle SQL](https://img.shields.io/badge/Oracle-SQL%20%26%20PL%2FSQL-F80000?style=for-the-badge&logo=oracle&logoColor=white)](https://www.oracle.com/database/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/)

<br/>

> A full-stack bill-splitting and expense-management web app that lets groups of friends, roommates, and travellers track shared expenses, calculate individual balances, and settle debts efficiently — powered by an Oracle SQL/PL-SQL backend with stored procedures, triggers, functions, and cursors.

<br/>

**[💰 Try SplitEase Live →](https://splitease101.vercel.app/)**

<br/>

</div>

---
## 📸 Screenshots

<div align="center">

<table>
  <tr>
    <td align="center"><b> Landing Page & Login </b></td>
    <td align="center"><b> Home Dashboard </b></td>
    <td align="center"><b> Group Dashboard </b></td>
  </tr>
  <tr>
    <td><img width="796" height="825" alt="image" src="https://github.com/user-attachments/assets/0a6f8ddd-6e25-47ee-9b1c-743ff8429cd6" /></td>
    <td><img width="1919" height="702" alt="image" src="https://github.com/user-attachments/assets/91047f0a-b99f-4e83-88e9-c7a31533c98d" /></td>
    <td><img width="1919" height="599" alt="image" src="https://github.com/user-attachments/assets/2346a787-e69d-4844-ab73-8406499aa18e" /></td>
  </tr>
  <tr>
    <td align="center"><b> Add Expense </b></td>
    <td align="center"><b> Balances & Settle Up </b></td>
    <td align="center"><b> Analytics </b></td>
  </tr>
  <tr>
    <td><img width="543" height="480" alt="image" src="https://github.com/user-attachments/assets/59e24eba-527e-4c2b-8a95-11cddd666c78" /></td>
    <td><img width="1919" height="684" alt="image" src="https://github.com/user-attachments/assets/e50535d6-351a-4c5d-94ae-bc8aa13c3ab1" /></td>
    <td><img width="1919" height="648" alt="image" src="https://github.com/user-attachments/assets/588478db-b60e-4fd3-a420-05d4110367a6" /></td>
  </tr>
</table>

</div>

---

## 🎯 What is SplitEase?

**SplitEase** is not just a calculator. It is a full expense-intelligence platform built as a semester project for **CS2301 Database Systems** at FAST NUCES Chiniot-Faisalabad Campus. Every single feature is backed by a real database concept from the course.

The app uses an **Oracle SQL/PL-SQL backend (Also a touch of Supabase)** to power 4 core modules — from normalised schema design and complex JOIN queries to stored procedures, triggers, and explicit cursors — all wired to a clean React front-end.

---

## ✨ Features

### 👤 1. User Management
Register and log in with secure credential storage. Manage your profile — name, email, avatar, and currency preference. Build a friend/contact list to quickly add members when creating groups.

---

### 👥 2. Group Management
Create named groups (e.g., *Trip to Lahore*, *Flat Expenses*, *Dinner Night*). Add or remove members at any time. View a consolidated group dashboard showing all expenses and live running balances.

---

### 🧾 3. Expense Tracking *(Core Module)*
Log expenses with a title, amount, date, category, and payer. Split costs equally, by percentage, or by exact amounts per member. Edit and delete expenses with every change automatically recorded in an audit trail via triggers. Browse category-wise breakdowns across food, travel, utilities, entertainment, and more.

---

### ⚖️ 4. Balance & Settlement *(Showstopper)*
Automatic per-member balance calculation powered by a PL/SQL stored function. A simplified debt graph minimises the number of transactions needed to fully settle up. Mark settlements as paid and watch balances update in real time. A full settlement history log keeps records for every group.

---

## 🗂️ Database Schema

| Property | Detail |
|---|---|
| **Database** | Oracle SQL & PL/SQL & Supabase|
| **Tables** | 8 interrelated tables |
| **Normalisation** | Third Normal Form (3NF) |
| **Key constraints** | Primary keys, Foreign keys, NOT NULL, UNIQUE, CHECK |

### Tables Overview

| Table Name | Primary Key | Description |
|---|---|---|
| `Users` | user_id | All registered user accounts |
| `Groups` | group_id | Expense groups created by users |
| `GroupMembers` | (group_id, user_id) | M:N join — users within groups |
| `Expenses` | expense_id | Individual expense records |
| `ExpenseSplits` | split_id | Per-member share of each expense |
| `Categories` | category_id | Expense categories (food, travel, etc.) |
| `Settlements` | settlement_id | Records of debt repayments |
| `AuditLog` | log_id | Trigger-maintained audit trail |

---

## 🧠 Database Concepts Implemented

| Component | Concept | Key Demonstration |
|---|---|---|
| ERD / EERD | Conceptual Design | 8 entities, relationships, specialisation hierarchies, cardinalities |
| Schema | Physical Design | Primary/foreign keys, constraints, 3NF normalised tables |
| SQL Queries | Data Retrieval | JOINs, subqueries, aggregates, GROUP BY, HAVING |
| Stored Procedures | PL/SQL Logic | `AddExpense` and `RecordSettlement` with IN/OUT parameters |
| Functions | Computed Values | `GetUserBalance` and `GetGroupTotal` returning numeric results |
| Triggers | Automation | Audit trail and split validation enforced automatically |
| Cursor | Iterative Processing | Unsettled balance report generated row by row |
| Web App | Application Layer | Live deployment connecting Oracle DB to React front-end |

---

## ⚙️ PL/SQL Components

### Stored Procedures

| Procedure Name | Parameters | Purpose |
|---|---|---|
| `AddExpense` | IN: group_id, payer_id, amount, desc, category_id | Inserts a new expense and distributes splits equally among group members |
| `RecordSettlement` | IN: group_id, payer_id, payee_id, amount | Logs a settlement transaction and recalculates outstanding balances |

### Functions

| Function Name | Returns | Purpose |
|---|---|---|
| `GetUserBalance` | NUMBER | Calculates the net balance of a user within a group (positive = owed money, negative = owes money) |
| `GetGroupTotal` | NUMBER | Returns the total amount spent in a group across all expenses |

### Triggers

| Trigger Name | Timing / Event | Purpose |
|---|---|---|
| `trg_expense_audit` | AFTER INSERT OR UPDATE OR DELETE ON Expenses | Writes an audit record to AuditLog with operation type, changed values, and timestamp |
| `trg_validate_split` | BEFORE INSERT ON ExpenseSplits | Validates that the sum of all splits does not exceed the total expense amount; raises exception if violated |

### Cursor
An explicit cursor iterates over all unsettled balances within a group, processes each member's net position, and generates a human-readable summary of who owes whom and how much — with full exception handling for `NO_DATA_FOUND` and `OTHERS` conditions.

---

## 🛠️ Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| **React 18** | UI framework |
| **Vite** | Build tool and dev server |
| **Tailwind CSS** | Styling and theming |
| **React Router** | Page navigation |

### Backend / Database
| Technology | Purpose |
|---|---|
| **Oracle Database** | Primary database engine |
| **SQL** | Schema definition, queries, aggregates, JOINs |
| **PL/SQL** | Stored procedures, functions, triggers, cursors |

### Deployment
| Platform | Purpose |
|---|---|
| **Vercel** | Frontend deployment |
| **Oracle DB Server & Supabase** | Database backend |

---

## 🚀 Getting Started

### Prerequisites
Make sure you have these installed:
- Node.js 18+
- npm or yarn
- Oracle Database (local or cloud instance)
- Oracle SQL Developer or similar client

---

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/splitease.git
cd splitease
```

---

### 2. Set up the Database
```sql
-- Run the schema script to create all 8 tables
@schema.sql

-- Run the PL/SQL script to create procedures, functions, triggers, and cursors
@plsql.sql

-- (Optional) Seed with sample data
@seed.sql
```

---

### 3. Set up the Frontend
```bash
# Navigate to frontend folder
cd splitease-frontend

# Install dependencies
npm install

# Start the development server
npm run dev
```
Frontend runs at **http://localhost:5173**

---

### 4. Configure environment
Create a `.env` file in the frontend folder:
```env
VITE_API_BASE_URL=http://localhost:5000/api
VITE_DB_CONNECTION_STRING=your_oracle_connection_string_here
```

---

### 5. Open the app
Go to **http://localhost:5173** in your browser and you are good to go!

---

## 📁 Project Structure

```
splitease/
│
├── splitease-frontend/            # React + Vite frontend
│   ├── src/
│   │   ├── components/            # Reusable components
│   │   │   ├── ExpenseCard.jsx    # Expense display card
│   │   │   ├── BalanceBadge.jsx   # Colour-coded balance indicator
│   │   │   ├── GroupCard.jsx      # Group summary card
│   │   │   └── BottomNav.jsx      # Bottom navigation bar
│   │   │
│   │   ├── pages/                 # App screens
│   │   │   ├── Landing.jsx        # Landing / splash screen
│   │   │   ├── Login.jsx          # Login screen
│   │   │   ├── Signup.jsx         # Sign up screen
│   │   │   ├── Dashboard.jsx      # Group overview dashboard
│   │   │   ├── AddExpense.jsx     # Log a new expense
│   │   │   ├── Balances.jsx       # Per-member balance view
│   │   │   ├── SettleUp.jsx       # Settlement flow
│   │   │   └── Profile.jsx        # User profile & settings
│   │   │
│   │   ├── services/
│   │   │   └── api.js             # All backend API calls
│   │   │
│   │   └── App.jsx                # Routes and app entry
│   │
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── splitease-db/                  # Oracle SQL & PL/SQL files
│   ├── schema.sql                 # Table definitions and constraints
│   ├── queries.sql                # SELECT, JOIN, aggregate queries
│   ├── procedures.sql             # AddExpense, RecordSettlement
│   ├── functions.sql              # GetUserBalance, GetGroupTotal
│   ├── triggers.sql               # Audit and validation triggers
│   ├── cursor.sql                 # Unsettled balance cursor
│   └── seed.sql                   # Sample data for testing
│
└── README.md
```

---

## 🔌 SQL Query Categories

| Query Category | Example Use Case | Clauses Used |
|---|---|---|
| Basic SELECT | Fetch all expenses in a group | WHERE, ORDER BY |
| Aggregates | Total spending per member | GROUP BY, HAVING, SUM, AVG |
| INNER JOIN | Expenses with payer names | JOIN Users ON expense.paid_by |
| LEFT JOIN | Members with no expenses yet | LEFT JOIN ExpenseSplits |
| Correlated Subquery | Members who owe more than average | EXISTS, IN |
| Non-Correlated Subquery | Groups above expense threshold | WHERE group_id IN (...) |

---

## 👥 Team

<div align="center">

| | Name | Role |
|:-:|---|---|
| 🎨 | **Anass Khan** | Frontend Development & UI/UX — Built the complete React + Vite web app, all screens, reusable components, animations, and API integration |
| 🗄️ | **Shawal Hussain** | Database Design & Backend — Designed the full Oracle SQL schema, wrote all PL/SQL components (procedures, functions, triggers, cursors), and wired the database to the application layer |

</div>

---

## 📖 References

- Ramez Elmasri & Shamkant Navathe — *Fundamentals of Database Systems*
- Abraham Silberschatz — *Database System Concepts*
- Oracle PL/SQL Documentation — [docs.oracle.com](https://docs.oracle.com/en/database/oracle/oracle-database/)

---

<div align="center">

<br/>

Made with 💸 and a lot of SQL by **Anass Khan** & **Shawal Hussain**

**FAST NUCES Chiniot-Faisalabad Campus — Spring 2026**

<br/>

[![Live Demo](https://img.shields.io/badge/🚀_Try_SplitEase_Now-4F46E5?style=for-the-badge)](https://splitease101.vercel.app/)

</div>
