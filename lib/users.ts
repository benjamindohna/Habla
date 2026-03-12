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
    passwordHash: "$2b$10$fIQ0W./whHAt.JnSKLidlOHzNC9Nkv2zdJ9azO3IE3/BJkdH4qYPO",
    // password: HablaAdmin1!
  },
  {
    email: "alice@habla.app",
    passwordHash: "$2b$10$5Sv4/xhfSqDax0O7cKbjVuMHbsH52kHqYhpERfBupBc/eO/DkaoJu",
    // password: AliceSpanish2!
  },
  {
    email: "bob@habla.app",
    passwordHash: "$2b$10$ANV3ACyXKMuqrl.ZjlDMROrLn/9Ib5tIcPX5duIroi9s2UPRagKCG",
    // password: BobHabla3!
  },
  {
    email: "carlos@habla.app",
    passwordHash: "$2b$10$f4/MXpcX3.vRLS4hq8d/LOGfapClKwohI7FKbmN9DUf98M.eKeUdS",
    // password: CarlosLingua4!
  },
  {
    email: "diana@habla.app",
    passwordHash: "$2b$10$x2AFHdf7DmkIbJPv3BqVZuO0ZeaE1VJyF7b2/n0BX.pmXEcq.a4d6",
    // password: DianaLearn5!
  },
];
