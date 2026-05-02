const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { Expo } = require('expo-server-sdk');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || '/data/data.json';
const expo = new Expo();

app.use(cors());
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Initialize database
function initDB() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  if (!fs.existsSync(DB_PATH)) {
    const initialData = {
      users: [],
      courtChecks: [],
      availableCourts: []
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2));
  }
}

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (error) {
    console.error('Error reading database:', error);
    return { users: [], courtChecks: [], availableCourts: [] };
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing database:', error);
  }
}

// Mock function to check court availability
function checkCourtAvailability() {
  // Simulate checking Joe DiMaggio tennis courts
  // In a real app, this would call the SF Recreation API
  const courts = ['Court 1', 'Court 2', 'Court 3', 'Court 4'];
  const timeSlots = ['5:00 PM', '5:30 PM', '6:00 PM', '6:30 PM', '7:00 PM', '7:30 PM', '8:00 PM'];
  
  const availableSlots = [];
  
  // Random availability simulation
  courts.forEach(court => {
    timeSlots.forEach(time => {
      if (Math.random() > 0.7) { // 30% chance of availability
        availableSlots.push({
          court,
          time,
          date: getNextFriday(),
          id: `${court}-${time}-${Date.now()}`
        });
      }
    });
  });
  
  return availableSlots;
}

function getNextFriday() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  const nextFriday = new Date(today);
  nextFriday.setDate(today.getDate() + (daysUntilFriday === 0 ? 7 : daysUntilFriday));
  return nextFriday.toDateString();
}

async function sendNotifications(availableSlots, pushTokens) {
  if (availableSlots.length === 0 || pushTokens.length === 0) return;
  
  const messages = [];
  
  pushTokens.forEach(token => {
    if (Expo.isExpoPushToken(token)) {
      messages.push({
        to: token,
        sound: 'default',
        title: 'Tennis Courts Available! 🎾',
        body: `${availableSlots.length} slots available at Joe DiMaggio courts this Friday after 5 PM`,
        data: { availableSlots }
      });
    }
  });
  
  if (messages.length > 0) {
    try {
      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        await expo.sendPushNotificationsAsync(chunk);
      }
      console.log(`Sent ${messages.length} notifications for ${availableSlots.length} available slots`);
    } catch (error) {
      console.error('Error sending notifications:', error);
    }
  }
}

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Tennis Court Checker API is running', timestamp: new Date().toISOString() });
});

// Register push token
app.post('/api/register-token', (req, res) => {
  const { pushToken } = req.body;
  
  if (!pushToken) {
    return res.status(400).json({ error: 'Push token required' });
  }
  
  const data = readDB();
  
  if (!data.users.includes(pushToken)) {
    data.users.push(pushToken);
    writeDB(data);
  }
  
  res.json({ success: true, message: 'Push token registered' });
});

// Get current availability
app.get('/api/courts/availability', (req, res) => {
  const data = readDB();
  const now = new Date();
  
  // Add a new check record
  data.courtChecks.push({
    timestamp: now.toISOString(),
    day: now.toDateString()
  });
  
  // Check availability
  const availableSlots = checkCourtAvailability();
  data.availableCourts = availableSlots;
  
  writeDB(data);
  
  res.json({
    available: availableSlots,
    lastChecked: now.toISOString(),
    nextFriday: getNextFriday()
  });
});

// Get check history
app.get('/api/history', (req, res) => {
  const data = readDB();
  
  res.json({
    totalChecks: data.courtChecks.length,
    registeredUsers: data.users.length,
    recentChecks: data.courtChecks.slice(-10).reverse()
  });
});

// Manual notification trigger (for testing)
app.post('/api/test-notification', async (req, res) => {
  const data = readDB();
  const testSlots = [{
    court: 'Court 1',
    time: '6:00 PM',
    date: getNextFriday(),
    id: 'test-slot'
  }];
  
  await sendNotifications(testSlots, data.users);
  res.json({ success: true, message: 'Test notification sent' });
});

// Initialize database
initDB();

// Schedule court checking every 30 minutes during weekdays
cron.schedule('*/30 * * * 1-5', async () => {
  console.log('Checking court availability...');
  
  const data = readDB();
  const availableSlots = checkCourtAvailability();
  
  // If we found new availability, send notifications
  if (availableSlots.length > 0) {
    const previousAvailability = data.availableCourts || [];
    const newSlots = availableSlots.filter(slot => 
      !previousAvailability.some(prev => prev.id === slot.id)
    );
    
    if (newSlots.length > 0) {
      await sendNotifications(newSlots, data.users);
    }
  }
  
  // Update stored availability
  data.availableCourts = availableSlots;
  data.courtChecks.push({
    timestamp: new Date().toISOString(),
    slotsFound: availableSlots.length
  });
  
  writeDB(data);
});

app.listen(PORT, () => {
  console.log(`Tennis court checker server running on port ${PORT}`);
});