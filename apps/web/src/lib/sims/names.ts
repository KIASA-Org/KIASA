/** First and last names for new simulated members, mixed at random; the admin
 * renames any of them as they like. */
const FIRST = [
  "Olivia", "Liam", "Emma", "Noah", "Ava", "Mateo", "Sophia", "Lucas", "Isabella", "Ethan", "Mia", "Daniel", "Amelia", "James",
  "Harper", "Benjamin", "Evelyn", "Samuel", "Abigail", "David", "Emily", "Joseph", "Ella", "Gabriel", "Chloe", "Julian", "Grace",
  "Adrian", "Zoe", "Nathan", "Hannah", "Isaac", "Layla", "Aaron", "Nora", "Ryan", "Lily", "Leo", "Aria", "Owen", "Maya", "Caleb",
  "Priya", "Arjun", "Mei", "Hiro", "Yuna", "Min-jun", "Seo-yeon", "Wei", "Lin", "Omar", "Zara", "Yusuf", "Amara", "Kwame",
  "Chiara", "Marco", "Elena", "Tomás", "Lucía", "Mateus", "Ana", "Sven", "Ingrid", "Lars", "Anika", "Felix", "Clara", "Jonas",
];
const LAST = [
  "Smith", "Johnson", "Garcia", "Martinez", "Brown", "Davis", "Lopez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Lee",
  "Walker", "Hall", "Allen", "Young", "King", "Wright", "Scott", "Green", "Baker", "Adams", "Nelson", "Hill", "Campbell",
  "Mitchell", "Roberts", "Carter", "Phillips", "Evans", "Turner", "Torres", "Parker", "Collins", "Edwards", "Stewart", "Morris",
  "Patel", "Shah", "Chen", "Wang", "Tanaka", "Sato", "Kim", "Park", "Nguyen", "Tran", "Hassan", "Ali", "Okafor", "Mensah",
  "Rossi", "Bianchi", "Fernandes", "Silva", "Costa", "Novak", "Larsen", "Berg", "Schmidt", "Weber", "Dubois", "Moreau",
];

/** `count` names, none already taken (case aside), none twice. */
export function freshNames(count: number, taken: string[]): string[] {
  const used = new Set(taken.map(name => name.toLowerCase()));
  const made: string[] = [];
  for (let tries = 0; made.length < count && tries < count * 200; tries++) {
    const name = `${FIRST[Math.floor(Math.random() * FIRST.length)]} ${LAST[Math.floor(Math.random() * LAST.length)]}`;
    if (used.has(name.toLowerCase())) continue;
    used.add(name.toLowerCase());
    made.push(name);
  }
  return made;
}

/** An address for a simulated member: on KIASA's own domain, so it is never anyone's. */
export const simEmail = (name: string) =>
  `${name.toLowerCase().normalize("NFD").replace(/[^\w\s-]/g, "").trim().replace(/[\s-]+/g, ".")}.${Math.random().toString(36).slice(2, 7)}@members.kiasa.tech`;
