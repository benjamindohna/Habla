import { upsertUser, setUserInterests, getUserByEmail } from "../lib/users";

// Bootstrap user records. Password hashes are bcrypt(plaintext, 10).
// To add a user, generate a hash with:
//   node -e "const b = require('bcryptjs'); console.log(b.hashSync('yourpassword', 10))"

interface SeedUser {
  email: string;
  passwordHash: string;
  level: number;
  interests: string[];
}

const SEED_USERS: SeedUser[] = [
  {
    email: "admin@habla.app",
    passwordHash: "$2b$10$EDLzkiN4S7iVvLoTIV1FdeuU9feJ1N2G52XBytT6YIDHTuoUUunLm",
    level: 50,
    interests: [
      "cars",
      "football",
      "psychology",
      "space",
      "space novels (Dune, Project Hail Mary)",
    ],
  },
  {
    email: "alice@habla.app",
    passwordHash: "$2b$10$n3itOSNUW9ueVQt0XJwniOjAQevLMhFE1nFa3PMpM4wZJk7IG6lAa",
    level: 30,
    interests: [],
  },
  {
    email: "bob@habla.app",
    passwordHash: "$2b$10$cqDABLIxK9BztntcmIOCnu6e7mCjhxETrfRxbwwa58aljXOeQGkha",
    level: 30,
    interests: [],
  },
  {
    email: "carlos@habla.app",
    passwordHash: "$2b$10$6al5VDFMH/pxPaHIPh4aV.TvZF6/k9pLCAJUdaISAJ9U1bQGZMBpS",
    level: 30,
    interests: [],
  },
  {
    email: "diana@habla.app",
    passwordHash: "$2b$10$3n9fNEXcnwm071PDUz07RuoJE0IzFo1CiZEdjQVz17thc39o/DfYu",
    level: 30,
    interests: [],
  },
];

function seed() {
  console.log("Seeding users…");
  for (const u of SEED_USERS) {
    upsertUser({
      email: u.email,
      passwordHash: u.passwordHash,
      nativeLanguage: "German",
      level: u.level,
    });
    const row = getUserByEmail(u.email);
    if (!row) throw new Error(`Failed to find ${u.email} after upsert`);
    setUserInterests(row.id, u.interests);
    console.log(`  ${u.email}  level=${u.level}  interests=${u.interests.length}`);
  }
  console.log("Done.");
}

seed();
