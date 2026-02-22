require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'asstes', 'farm_copilot.db');
const db = new sqlite3.Database(DB_PATH, err => {
    if (err) { console.error('DB Error:', err.message); process.exit(1); }
    console.log('Connected to database:', DB_PATH);
});

const crops = ['Wheat', 'Rice / Paddy', 'Maize', 'Soybean', 'Cotton', 'Groundnut', 'Sugarcane', 'Onion', 'Tomato', 'Potato'];
const soils = ['Sandy', 'Loamy', 'Clay', 'Silty', 'Black Cotton', 'Red Laterite', 'Alluvial'];
const irrigation = ['Rain-fed only', 'Borewell / Tubewell', 'Canal / River', 'Drip Irrigation', 'Sprinkler System', 'Tank / Pond'];
const states = ['Maharashtra', 'Uttar Pradesh', 'Punjab', 'Karnataka', 'Tamil Nadu', 'Rajasthan', 'Madhya Pradesh', 'Gujarat', 'Bihar', 'Haryana'];
const roles = ['farmer', 'farmer', 'farmer', 'farmer', 'agronomist', 'manager'];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

async function seed() {
    // Pre-hash once — same password for all, same hash cost → reuse hash
    const hash = await bcrypt.hash('123456', 10);
    console.log('Password hashed. Inserting 1000 users...');

    const stmt = db.prepare(`
        INSERT OR IGNORE INTO users
            (full_name, email, password_hash, phone, state, district,
             role, experience_yrs, farm_size_acres, primary_crop, soil_type, irrigation_src)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        for (let n = 1; n <= 1000; n++) {
            stmt.run(
                String(n),                          // full_name = "1" ... "1000"
                `${n}@${n}.com`,                    // email
                hash,                               // bcrypt hash of "123456"
                `+91 ${9000000000 + n}`,            // phone
                pick(states),                       // state
                `District-${n}`,                    // district
                pick(roles),                        // role
                Math.floor(Math.random() * 30),     // experience_yrs 0-29
                +(Math.random() * 50 + 0.5).toFixed(1), // farm_size_acres 0.5-50.5
                pick(crops),                        // primary_crop
                pick(soils),                        // soil_type
                pick(irrigation)                    // irrigation_src
            );
        }

        db.run('COMMIT', err => {
            if (err) console.error('Commit error:', err.message);
            else console.log('✅  1000 users seeded successfully.');
            stmt.finalize();
            db.close();
        });
    });
}

seed().catch(err => { console.error(err); process.exit(1); });
