// ─────────────────────────────────────────────────────────────────────────────
// USER ACCOUNTS
// ─────────────────────────────────────────────────────────────────────────────
// To add or remove a user: edit the array below.
//
// To generate a hash for a new password, run this command in your terminal
// (from the project root):
//
//   node -e "const b = require('bcryptjs'); console.log(b.hashSync('yourpassword', 10))"
//
// Replace the passwordHash with the output of that command.
// ─────────────────────────────────────────────────────────────────────────────

export interface User {
  email: string;
  passwordHash: string;
}

export const USERS: User[] = [
  {
    email: "admin@habla.app",
    passwordHash: "$2b$10$EDLzkiN4S7iVvLoTIV1FdeuU9feJ1N2G52XBytT6YIDHTuoUUunLm",
  },
  {
    email: "alice@habla.app",
    passwordHash: "$2b$10$n3itOSNUW9ueVQt0XJwniOjAQevLMhFE1nFa3PMpM4wZJk7IG6lAa",
  },
  {
    email: "bob@habla.app",
    passwordHash: "$2b$10$cqDABLIxK9BztntcmIOCnu6e7mCjhxETrfRxbwwa58aljXOeQGkha",
  },
  {
    email: "carlos@habla.app",
    passwordHash: "$2b$10$6al5VDFMH/pxPaHIPh4aV.TvZF6/k9pLCAJUdaISAJ9U1bQGZMBpS",
  },
  {
    email: "diana@habla.app",
    passwordHash: "$2b$10$3n9fNEXcnwm071PDUz07RuoJE0IzFo1CiZEdjQVz17thc39o/DfYu",
  },
];
