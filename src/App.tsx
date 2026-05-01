/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { Download, Trash2, Edit2, Check, X, Search, Calendar as CalendarIcon, Bed, DoorOpen, Phone, MapPin, ClipboardList, Info, LogOut, User, Loader2, Sparkles, ChevronDown, ChevronUp, Filter, BarChart3, TrendingUp, MessageCircle, Users, Settings, Home, DollarSign, Upload, Image, Heart, Camera, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ZimmerAvailability, CustomerRequest, DateStatus, UserProfile, UserRole, ZimmerUnit } from './types.ts';
import { HebrewCalendar, HDate, Location, Event } from '@hebcal/core';
import { parseWhatsAppText } from './lib/gemini.ts';
import { auth, db, loginWithGoogle, handleFirestoreError, OperationType, uploadLogo, uploadZimmerImage } from './firebase.ts';
import { onAuthStateChanged, User as FirebaseUser, signOut } from 'firebase/auth';
import { collection, onSnapshot, addDoc, deleteDoc, updateDoc, doc, query, orderBy, serverTimestamp, getDoc, setDoc, deleteField } from 'firebase/firestore';
import { DayPicker } from 'react-day-picker';
import { format, parseISO, isValid, parse, addDays, eachDayOfInterval, startOfMonth, endOfMonth, isSameDay } from 'date-fns';
import { he } from 'date-fns/locale';
import 'react-day-picker/dist/style.css';
import { initGoogleCalendar, signInToCalendar, signOutFromCalendar, isCalendarSignedIn, syncZimmerToCalendar, getCalendarUserEmail } from './lib/googleCalendar';
import { sanitizeForDisplay, sanitizePhone, isValidIsraeliPhone, decodeForEdit } from './lib/sanitize';
import { compressImage } from './lib/imageCompression';

// Matching algorithm types and functions
interface MatchResult {
  zimmer: ZimmerAvailability;
  score: number;
  matchDetails: {
    locationMatch: boolean;
    roomsMatch: boolean;
    bedsMatch: boolean;
    datesOverlap: boolean;
  };
}

function normalizeLocation(location: string): string {
  return location.trim().toLowerCase()
    .replace(/['"״׳]/g, '')
    .replace(/\s+/g, ' ');
}

function checkLocationMatch(zimmerLocation: string, requestedLocation?: string): boolean {
  if (!requestedLocation || requestedLocation === 'כל המקומות' || requestedLocation.trim() === '') {
    return true;
  }
  const normZimmer = normalizeLocation(zimmerLocation);
  const normRequest = normalizeLocation(requestedLocation);
  return normZimmer.includes(normRequest) || normRequest.includes(normZimmer);
}

// Get next occurrence of a day of week (0=Sunday, 6=Saturday)
function getNextDayOfWeek(dayOfWeek: number, fromDate: Date = new Date()): Date {
  const result = new Date(fromDate);
  const currentDay = result.getDay();
  const daysUntil = (dayOfWeek - currentDay + 7) % 7 || 7;
  result.setDate(result.getDate() + daysUntil);
  return result;
}

// Hebrew parsha names mapping
const parshaNames: { [key: string]: string } = {
  'Bereshit': 'בראשית', 'Noach': 'נח', 'Lech-Lecha': 'לך לך', 'Vayera': 'וירא',
  'Chayei Sara': 'חיי שרה', 'Toldot': 'תולדות', 'Vayetzei': 'ויצא', 'Vayishlach': 'וישלח',
  'Vayeshev': 'וישב', 'Miketz': 'מקץ', 'Vayigash': 'ויגש', 'Vayechi': 'ויחי',
  'Shemot': 'שמות', 'Vaera': 'וארא', 'Bo': 'בא', 'Beshalach': 'בשלח',
  'Yitro': 'יתרו', 'Mishpatim': 'משפטים', 'Terumah': 'תרומה', 'Tetzaveh': 'תצוה',
  'Ki Tisa': 'כי תשא', 'Vayakhel': 'ויקהל', 'Pekudei': 'פקודי',
  'Vayikra': 'ויקרא', 'Tzav': 'צו', 'Shmini': 'שמיני', 'Tazria': 'תזריע',
  'Metzora': 'מצורע', 'Achrei Mot': 'אחרי מות', 'Kedoshim': 'קדושים',
  'Emor': 'אמור', 'Behar': 'בהר', 'Bechukotai': 'בחוקותי',
  'Bamidbar': 'במדבר', 'Nasso': 'נשא', 'Beha\'alotcha': 'בהעלותך',
  'Sh\'lach': 'שלח', 'Korach': 'קורח', 'Chukat': 'חוקת', 'Balak': 'בלק',
  'Pinchas': 'פנחס', 'Matot': 'מטות', 'Masei': 'מסעי',
  'Devarim': 'דברים', 'Vaetchanan': 'ואתחנן', 'Eikev': 'עקב', 'Re\'eh': 'ראה',
  'Shoftim': 'שופטים', 'Ki Teitzei': 'כי תצא', 'Ki Tavo': 'כי תבוא',
  'Nitzavim': 'נצבים', 'Vayeilech': 'וילך', 'Ha\'azinu': 'האזינו',
  'Vezot Haberakhah': 'וזאת הברכה'
};

// Check if a date range is in the past
function isDateRangePast(dateStr: string): boolean {
  const dates = parseDateRange(dateStr);
  if (dates.length === 0) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check if all dates are in the past
  const lastDate = dates[dates.length - 1];
  lastDate.setHours(0, 0, 0, 0);

  return lastDate < today;
}

// Get detailed date info (Hebrew date, day of week, parsha)
function getDetailedDateInfo(dateStr: string): { original: string; details: string; isPast: boolean } | null {
  const dates = parseDateRange(dateStr);
  if (dates.length === 0) return null;

  const hebrewDaysOfWeek = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  try {
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];

    // Check if past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDateCopy = new Date(endDate);
    endDateCopy.setHours(0, 0, 0, 0);
    const isPast = endDateCopy < today;

    // Get Hebrew dates
    const startHDate = new HDate(startDate);
    const endHDate = new HDate(endDate);

    // Day of week
    const startDayName = hebrewDaysOfWeek[startDate.getDay()];
    const endDayName = hebrewDaysOfWeek[endDate.getDay()];

    // Hebrew date display
    const startHebrewDate = startHDate.renderGematriya();
    const endHebrewDate = endHDate.renderGematriya();

    // Check for Shabbat parsha
    let parsha = '';
    for (const date of dates) {
      if (date.getDay() === 6) { // Saturday
        const hd = new HDate(date);
        try {
          const sedra = HebrewCalendar.getSedra(hd.getFullYear(), true); // true = Israel
          const parshaForDate = sedra.lookup(hd);
          if (parshaForDate && parshaForDate.parsha && parshaForDate.parsha.length > 0) {
            // Translate parsha names to Hebrew
            const hebrewParsha = parshaForDate.parsha.map((p: string) => parshaNames[p] || p).join('-');
            parsha = 'פרשת ' + hebrewParsha;
            break;
          }
        } catch {
          // Sedra lookup failed, continue without parsha
        }
      }
    }

    // Build details string
    let details = '';
    if (dates.length === 1) {
      details = `יום ${startDayName} | ${startHebrewDate}`;
    } else {
      details = `${startDayName} - ${endDayName} | ${startHebrewDate} - ${endHebrewDate}`;
    }

    if (parsha) {
      details += ` | ${parsha}`;
    }

    return { original: dateStr, details, isPast };
  } catch (e) {
    console.error('Error getting date details:', e);
    return null;
  }
}

// Parse Hebrew date string to get date range (handles relative dates)
function parseDateRange(dateStr: string): Date[] {
  const dates: Date[] = [];
  const normalized = dateStr.trim();
  const lower = normalized.toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // === DATE PICKER FORMAT (dd/MM/yyyy - dd/MM/yyyy) ===
  const datePickerRangeMatch = normalized.match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (datePickerRangeMatch) {
    const startDate = new Date(
      parseInt(datePickerRangeMatch[3]), // year
      parseInt(datePickerRangeMatch[2]) - 1, // month (0-indexed)
      parseInt(datePickerRangeMatch[1]) // day
    );
    const endDate = new Date(
      parseInt(datePickerRangeMatch[6]),
      parseInt(datePickerRangeMatch[5]) - 1,
      parseInt(datePickerRangeMatch[4])
    );
    // Generate all dates in range
    const current = new Date(startDate);
    while (current <= endDate) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  // Single date format (dd/MM/yyyy)
  const singleDateMatch = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (singleDateMatch) {
    dates.push(new Date(
      parseInt(singleDateMatch[3]),
      parseInt(singleDateMatch[2]) - 1,
      parseInt(singleDateMatch[1])
    ));
    return dates;
  }

  // === RELATIVE DATE PATTERNS ===

  // "היום" - today
  if (lower.includes('היום')) {
    dates.push(new Date(today));
    return dates;
  }

  // "מחר" - tomorrow
  if (lower.includes('מחר')) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    dates.push(tomorrow);
    return dates;
  }

  // "שבת הקרובה" / "שבת הזו" / "סוף השבוע" / "סופש" - this weekend (Fri-Sat)
  if (lower.includes('שבת הקרובה') || lower.includes('שבת הזו') ||
      lower.includes('סוף השבוע') || lower.includes('סופש') ||
      lower.includes('ויקנד')) {
    const friday = getNextDayOfWeek(5, today);
    const saturday = new Date(friday);
    saturday.setDate(saturday.getDate() + 1);
    dates.push(friday, saturday);
    return dates;
  }

  // "שבת" alone (without "הקרובה") - next Saturday
  if (lower.includes('שבת') && !lower.includes('שבוע')) {
    dates.push(getNextDayOfWeek(6, today));
    return dates;
  }

  // Days of week with "הזה" / "הקרוב" / alone
  const daysOfWeek: { [key: string]: number } = {
    'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5
  };

  for (const [dayName, dayNum] of Object.entries(daysOfWeek)) {
    if (lower.includes(dayName)) {
      dates.push(getNextDayOfWeek(dayNum, today));
      return dates;
    }
  }

  // "השבוע" - this week (today until Saturday)
  if (lower.includes('השבוע') && !lower.includes('שבוע הבא')) {
    const endOfWeek = getNextDayOfWeek(6, today);
    let current = new Date(today);
    while (current <= endOfWeek) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  // "שבוע הבא" - next week
  if (lower.includes('שבוע הבא')) {
    const nextSunday = getNextDayOfWeek(0, today);
    for (let i = 0; i < 7; i++) {
      const d = new Date(nextSunday);
      d.setDate(d.getDate() + i);
      dates.push(d);
    }
    return dates;
  }

  // "חודש הבא" - next month
  if (lower.includes('חודש הבא')) {
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 2, 0).getDate();
    for (let d = 1; d <= lastDay; d++) {
      dates.push(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), d));
    }
    return dates;
  }

  // === ABSOLUTE DATE PATTERNS ===

  // Hebrew month names to month numbers
  const hebrewMonths: { [key: string]: number } = {
    'ינואר': 0, 'פברואר': 1, 'מרץ': 2, 'אפריל': 3, 'מאי': 4, 'יוני': 5,
    'יולי': 6, 'אוגוסט': 7, 'ספטמבר': 8, 'אוקטובר': 9, 'נובמבר': 10, 'דצמבר': 11
  };

  // Try to find month
  let month = -1;
  for (const [name, num] of Object.entries(hebrewMonths)) {
    if (lower.includes(name)) {
      month = num;
      break;
    }
  }

  if (month === -1) return dates;

  // Extract numbers (could be day or day range like "20-23")
  const numbers = normalized.match(/\d+/g);
  if (!numbers) return dates;

  const year = today.getFullYear();

  // Check if it's a range (e.g., "20-23")
  const rangeMatch = normalized.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (rangeMatch) {
    const startDay = parseInt(rangeMatch[1]);
    const endDay = parseInt(rangeMatch[2]);
    for (let d = startDay; d <= endDay; d++) {
      dates.push(new Date(year, month, d));
    }
  } else if (numbers.length > 0) {
    // Single date
    dates.push(new Date(year, month, parseInt(numbers[0])));
  }

  return dates;
}

// Check if zimmer is available on specific dates
function isZimmerAvailableOnDates(zimmer: ZimmerAvailability, requestedDates: Date[]): { available: boolean; status: 'available' | 'maybe' | 'occupied' } {
  if (requestedDates.length === 0) {
    return { available: true, status: 'available' };
  }

  let hasOccupied = false;
  let hasMaybe = false;

  for (const date of requestedDates) {
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    // Check dateStatuses first
    if (zimmer.dateStatuses && zimmer.dateStatuses[dateKey]) {
      const status = zimmer.dateStatuses[dateKey];
      if (status === 'occupied') {
        hasOccupied = true;
        break;
      } else if (status === 'maybe') {
        hasMaybe = true;
      }
    }

    // Check legacy disabledDates
    if (zimmer.disabledDates?.includes(dateKey)) {
      hasOccupied = true;
      break;
    }
  }

  if (hasOccupied) {
    return { available: false, status: 'occupied' };
  }

  return {
    available: true,
    status: hasMaybe ? 'maybe' : 'available'
  };
}

function checkDatesOverlap(zimmerDates: string, requestDates: string): boolean {
  // Simple text-based comparison since dates are stored as strings
  // Returns true if there's potential overlap or can't determine
  const normZimmer = zimmerDates.toLowerCase().trim();
  const normRequest = requestDates.toLowerCase().trim();

  // If either is empty or very generic, assume potential match
  if (!normZimmer || !normRequest || normZimmer === 'גמיש' || normRequest === 'גמיש') {
    return true;
  }

  // Check for common date patterns overlap
  // Extract any numbers that might be dates
  const zimmerNumbers: string[] = normZimmer.match(/\d+/g) || [];
  const requestNumbers: string[] = normRequest.match(/\d+/g) || [];

  // If we can find any common numbers, there might be an overlap
  if (zimmerNumbers.some(n => requestNumbers.includes(n))) {
    return true;
  }

  // Check for month name overlap (Hebrew months)
  const hebrewMonths = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const zimmerMonths = hebrewMonths.filter(m => normZimmer.includes(m));
  const requestMonths = hebrewMonths.filter(m => normRequest.includes(m));

  if (zimmerMonths.length > 0 && requestMonths.length > 0) {
    return zimmerMonths.some(m => requestMonths.includes(m));
  }

  // Default to true if we can't determine
  return true;
}

function findMatchingZimmers(request: CustomerRequest, zimmers: ZimmerAvailability[]): MatchResult[] {
  const matches: MatchResult[] = [];

  // Parse the requested dates
  const requestedDates = parseDateRange(request.dates);

  for (const zimmer of zimmers) {
    // First check if zimmer is available on requested dates
    const availability = isZimmerAvailableOnDates(zimmer, requestedDates);

    // Skip occupied zimmers
    if (!availability.available) {
      continue;
    }

    const locationMatch = checkLocationMatch(zimmer.location, request.locationPref);
    const roomsMatch = zimmer.rooms >= request.roomsNeeded;
    const bedsMatch = zimmer.beds >= request.bedsNeeded;
    const datesOverlap = checkDatesOverlap(zimmer.dates, request.dates);

    // Calculate score (0-100)
    let score = 0;
    if (locationMatch) score += 30;
    if (roomsMatch) score += 25;
    if (bedsMatch) score += 25;
    if (datesOverlap) score += 20;

    // Bonus for exact room/bed match
    if (zimmer.rooms === request.roomsNeeded) score += 5;
    if (zimmer.beds === request.bedsNeeded) score += 5;

    // Penalty for "maybe" availability
    if (availability.status === 'maybe') {
      score -= 10;
    }

    // Only include if at least 50% match (location OR rooms+beds)
    if (score >= 50) {
      matches.push({
        zimmer,
        score: Math.min(score, 100),
        matchDetails: { locationMatch, roomsMatch, bedsMatch, datesOverlap }
      });
    }
  }

  // Sort by score descending
  return matches.sort((a, b) => b.score - a.score);
}

// Calendar view utilities
const ZIMMER_COLORS = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#06b6d4', '#d946ef', '#0ea5e9', '#eab308', '#a855f7'
];

function getZimmerColor(index: number): string {
  return ZIMMER_COLORS[index % ZIMMER_COLORS.length];
}

function parseDateString(dateStr: string, year: number = new Date().getFullYear()): Date[] {
  const dates: Date[] = [];
  if (!dateStr) return dates;

  const normalized = dateStr.trim().toLowerCase();

  // Try to extract date ranges like "20-23.4", "20-23/4", "20-23 אפריל"
  const hebrewMonths: { [key: string]: number } = {
    'ינואר': 0, 'פברואר': 1, 'מרץ': 2, 'אפריל': 3, 'מאי': 4, 'יוני': 5,
    'יולי': 6, 'אוגוסט': 7, 'ספטמבר': 8, 'אוקטובר': 9, 'נובמבר': 10, 'דצמבר': 11
  };

  // Pattern: "20-23.4" or "20-23/4" or "20-23 לאפריל"
  const rangePattern = /(\d{1,2})\s*[-–]\s*(\d{1,2})[\s.\/]*(\d{1,2}|ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)/i;
  const rangeMatch = normalized.match(rangePattern);

  if (rangeMatch) {
    const startDay = parseInt(rangeMatch[1]);
    const endDay = parseInt(rangeMatch[2]);
    let month: number;

    if (isNaN(parseInt(rangeMatch[3]))) {
      // Hebrew month name
      const monthName = Object.keys(hebrewMonths).find(m => rangeMatch[3].includes(m));
      month = monthName ? hebrewMonths[monthName] : new Date().getMonth();
    } else {
      month = parseInt(rangeMatch[3]) - 1;
    }

    try {
      const startDate = new Date(year, month, startDay);
      const endDate = new Date(year, month, endDay);
      if (isValid(startDate) && isValid(endDate) && startDate <= endDate) {
        return eachDayOfInterval({ start: startDate, end: endDate });
      }
    } catch { }
  }

  // Pattern: single date "20.4" or "20/4"
  const singlePattern = /(\d{1,2})[\s.\/]+(\d{1,2})/;
  const singleMatch = normalized.match(singlePattern);
  if (singleMatch) {
    const day = parseInt(singleMatch[1]);
    const month = parseInt(singleMatch[2]) - 1;
    const date = new Date(year, month, day);
    if (isValid(date)) {
      return [date];
    }
  }

  return dates;
}

// Duplicate detection for requests
function normalizeString(str: string): string {
  return str.trim().toLowerCase()
    .replace(/['"״׳\-_.,]/g, '')
    .replace(/\s+/g, ' ');
}

function areRequestsDuplicates(a: CustomerRequest, b: CustomerRequest): boolean {
  // Same customer name
  const nameA = normalizeString(a.customerName);
  const nameB = normalizeString(b.customerName);
  if (nameA !== nameB) return false;

  // Same dates (normalized)
  const datesA = normalizeString(a.dates);
  const datesB = normalizeString(b.dates);
  if (datesA !== datesB) return false;

  // If we have contact info, it should match
  if (a.contactInfo && b.contactInfo) {
    const contactA = a.contactInfo.replace(/\D/g, '');
    const contactB = b.contactInfo.replace(/\D/g, '');
    if (contactA && contactB && contactA !== contactB) return false;
  }

  return true;
}

function findDuplicateRequests(requests: CustomerRequest[]): Map<string, string[]> {
  const duplicates = new Map<string, string[]>(); // original ID -> duplicate IDs
  const checked = new Set<string>();

  for (let i = 0; i < requests.length; i++) {
    if (checked.has(requests[i].id)) continue;

    const dupes: string[] = [];
    for (let j = i + 1; j < requests.length; j++) {
      if (checked.has(requests[j].id)) continue;

      if (areRequestsDuplicates(requests[i], requests[j])) {
        dupes.push(requests[j].id);
        checked.add(requests[j].id);
      }
    }

    if (dupes.length > 0) {
      duplicates.set(requests[i].id, dupes);
    }
    checked.add(requests[i].id);
  }

  return duplicates;
}

// Owner Registration Form Component
interface OwnerRegistrationFormProps {
  user: FirebaseUser;
  onSubmit: (details: UserProfile['zimmerDetails']) => Promise<void>;
  onCancel: () => void;
}

function OwnerRegistrationForm({ user, onSubmit, onCancel, initialData }: OwnerRegistrationFormProps & { initialData?: UserProfile['zimmerDetails'] }) {
  const [formData, setFormData] = useState({
    name: initialData?.name || '',
    phone: initialData?.phone || '',
    beds: initialData?.beds || 4,
    rooms: initialData?.rooms || 2,
    location: initialData?.location || '',
    website: initialData?.website || '',
    logo: initialData?.logo || '',
    images: initialData?.images || [] as string[],
    notes: initialData?.notes || ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [uploadingImageIndex, setUploadingImageIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoCameraRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const MAX_IMAGES = 3;

  const handleLogoUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('נא לבחור קובץ תמונה');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('התמונה גדולה מדי (מקסימום 5MB)');
      return;
    }

    setIsUploadingLogo(true);
    try {
      // Compress image before upload (logo - high quality, smaller size)
      const compressedFile = await compressImage(file, {
        maxWidth: 1024,
        maxHeight: 1024,
        quality: 0.9,
        maxSizeMB: 1
      });
      const url = await uploadLogo(compressedFile, user.uid);
      setFormData({ ...formData, logo: url });
    } catch (e: unknown) {
      console.error('Logo upload error:', e);
      const errorMsg = e instanceof Error ? e.message : 'שגיאה לא ידועה';
      alert(`שגיאה בהעלאת הלוגו: ${errorMsg}`);
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleImageUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('נא לבחור קובץ תמונה');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('התמונה גדולה מדי (מקסימום 10MB)');
      return;
    }
    if (formData.images.length >= MAX_IMAGES) {
      alert(`ניתן להעלות עד ${MAX_IMAGES} תמונות`);
      return;
    }

    const newIndex = formData.images.length;
    setUploadingImageIndex(newIndex);
    try {
      // Compress image before upload (high quality for gallery display)
      const compressedFile = await compressImage(file, {
        maxWidth: 1920,
        maxHeight: 1920,
        quality: 0.92,
        maxSizeMB: 2
      });
      const url = await uploadZimmerImage(compressedFile, user.uid, newIndex);
      console.log('[ImageUpload] Success! URL:', url);
      // Use callback form to avoid stale closure
      setFormData(prev => {
        const newImages = [...prev.images, url];
        console.log('[ImageUpload] Updated images array:', newImages);
        return { ...prev, images: newImages };
      });
    } catch (e: unknown) {
      console.error('Image upload error:', e);
      const errorMsg = e instanceof Error ? e.message : 'שגיאה לא ידועה';
      alert(`שגיאה בהעלאת התמונה: ${errorMsg}`);
    } finally {
      setUploadingImageIndex(null);
    }
  };

  const handleRemoveImage = (index: number) => {
    const newImages = formData.images.filter((_, i) => i !== index);
    setFormData({ ...formData, images: newImages });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleLogoUpload(file);
  };

  const handleImagesDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    const remainingSlots = MAX_IMAGES - formData.images.length;
    const filesToUpload = files.slice(0, remainingSlots);
    filesToUpload.forEach(file => handleImageUpload(file));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.phone || !formData.location) return;

    // Validate phone number
    if (!isValidIsraeliPhone(formData.phone)) {
      setPhoneError('מספר טלפון לא תקין. הזן מספר ישראלי (05X-XXXXXXX)');
      return;
    }
    setPhoneError(null);

    console.log('[FormSubmit] Submitting form with data:', {
      name: formData.name,
      logo: formData.logo ? 'YES' : 'NO',
      images: formData.images,
      imagesCount: formData.images.length
    });

    setIsSubmitting(true);
    try {
      await onSubmit(formData);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-face-bg flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-lg w-full border border-face-border">
        <div className="text-center mb-6">
          <img src="/logo.png" alt="ZimmerSync" className="w-16 h-16 rounded-full object-cover mx-auto shadow-lg mb-4" />
          <h1 className="text-2xl font-extrabold text-whatsapp-dark tracking-tighter">רישום הצימר שלך</h1>
          <p className="text-face-muted text-sm mt-2">
            שלום {user.displayName?.split(' ')[0]}, מלא את פרטי הצימר כדי להתחיל
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-face-muted block mb-1">שם הצימר *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="לדוגמה: צימר הגליל"
              className="w-full px-3 py-2 border border-face-border rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp-primary"
              required
            />
          </div>

          <div>
            <label className="text-xs font-bold text-face-muted block mb-1">מספר טלפון *</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => {
                setFormData({ ...formData, phone: e.target.value });
                if (phoneError) setPhoneError(null);
              }}
              placeholder="050-1234567"
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp-primary ${phoneError ? 'border-red-500' : 'border-face-border'}`}
              required
            />
            {phoneError && <p className="text-red-500 text-xs mt-1">{phoneError}</p>}
          </div>

          <div>
            <label className="text-xs font-bold text-face-muted block mb-1">מיקום *</label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              placeholder="לדוגמה: גליל עליון"
              className="w-full px-3 py-2 border border-face-border rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp-primary"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-face-muted block mb-1">מספר חדרים</label>
              <input
                type="number"
                min="1"
                max="50"
                value={formData.rooms}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 1;
                  setFormData({ ...formData, rooms: Math.max(1, Math.min(50, val)) });
                }}
                className="w-full px-3 py-2 border border-face-border rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp-primary"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-face-muted block mb-1">מספר מיטות</label>
              <input
                type="number"
                min="1"
                max="100"
                value={formData.beds}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 1;
                  setFormData({ ...formData, beds: Math.max(1, Math.min(100, val)) });
                }}
                className="w-full px-3 py-2 border border-face-border rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp-primary"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-face-muted block mb-1">קישור לאתר (אופציונלי)</label>
            <input
              type="url"
              value={formData.website}
              onChange={(e) => setFormData({ ...formData, website: e.target.value })}
              placeholder="https://..."
              className="w-full px-3 py-2 border border-face-border rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp-primary"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-face-muted block mb-1">לוגו הצימר</label>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`border-2 border-dashed rounded-lg p-4 transition-all ${
                isDragging
                  ? 'border-whatsapp-primary bg-whatsapp-primary/10'
                  : 'border-face-border hover:border-whatsapp-primary/50'
              }`}
            >
              {formData.logo ? (
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <img
                      src={formData.logo}
                      alt="לוגו"
                      className="w-16 h-16 rounded-lg object-cover border border-face-border"
                      onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }}
                    />
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, logo: '' })}
                      className="absolute -top-1 -right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 shadow-lg active:scale-95 transition-all"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-face-text font-medium">לוגו הועלה בהצלחה</p>
                    <p className="text-xs text-face-muted">לחץ על X להסרה</p>
                  </div>
                </div>
              ) : isUploadingLogo ? (
                <div className="flex flex-col items-center justify-center py-4">
                  <Loader2 className="animate-spin text-whatsapp-primary mb-2" size={32} />
                  <p className="text-sm text-face-muted">מעלה לוגו...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-4">
                  <div className="flex items-center gap-3 mb-3">
                    {/* Gallery button */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center gap-1 px-4 py-3 bg-whatsapp-primary/10 hover:bg-whatsapp-primary/20 rounded-lg transition-colors"
                    >
                      <Image size={24} className="text-whatsapp-primary" />
                      <span className="text-xs text-whatsapp-dark font-medium">גלריה</span>
                    </button>

                    {/* Camera button */}
                    <button
                      type="button"
                      onClick={() => logoCameraRef.current?.click()}
                      className="flex flex-col items-center gap-1 px-4 py-3 bg-whatsapp-primary/10 hover:bg-whatsapp-primary/20 rounded-lg transition-colors"
                    >
                      <Camera size={24} className="text-whatsapp-primary" />
                      <span className="text-xs text-whatsapp-dark font-medium">מצלמה</span>
                    </button>
                  </div>
                  <p className="text-xs text-face-muted text-center">
                    או גרור תמונה לכאן
                  </p>
                  <p className="text-[10px] text-face-muted mt-2">PNG, JPG עד 5MB</p>
                </div>
              )}
              {/* Gallery input - no capture */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleLogoUpload(file);
                  e.target.value = '';
                }}
                className="hidden"
              />
              {/* Camera input - with capture */}
              <input
                ref={logoCameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleLogoUpload(file);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </div>
          </div>

          {/* Images Section - Up to 3 images */}
          <div>
            <label className="text-xs font-bold text-face-muted block mb-1">
              תמונות הצימר (עד {MAX_IMAGES} תמונות)
            </label>

            {/* Existing images grid */}
            {formData.images.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                {formData.images.map((img, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={img}
                      alt={`תמונה ${index + 1}`}
                      className="w-full h-24 rounded-lg object-cover border border-face-border"
                      onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(index)}
                      className="absolute -top-1 -right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-1.5 shadow-lg active:scale-95 transition-all"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Upload area - show only if less than MAX_IMAGES */}
            {formData.images.length < MAX_IMAGES && (
              <div
                onDrop={handleImagesDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`border-2 border-dashed rounded-lg p-4 transition-all ${
                  isDragging
                    ? 'border-whatsapp-primary bg-whatsapp-primary/10'
                    : 'border-face-border hover:border-whatsapp-primary/50'
                }`}
              >
                {uploadingImageIndex !== null ? (
                  <div className="flex flex-col items-center justify-center py-4">
                    <Loader2 className="animate-spin text-whatsapp-primary mb-2" size={32} />
                    <p className="text-sm text-face-muted">מעלה תמונה...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-4">
                    <div className="flex items-center gap-3 mb-3">
                      {/* Gallery button */}
                      <button
                        type="button"
                        onClick={() => imageInputRef.current?.click()}
                        className="flex flex-col items-center gap-1 px-4 py-3 bg-whatsapp-primary/10 hover:bg-whatsapp-primary/20 rounded-lg transition-colors"
                      >
                        <Image size={24} className="text-whatsapp-primary" />
                        <span className="text-xs text-whatsapp-dark font-medium">גלריה</span>
                      </button>

                      {/* Camera button */}
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="flex flex-col items-center gap-1 px-4 py-3 bg-whatsapp-primary/10 hover:bg-whatsapp-primary/20 rounded-lg transition-colors"
                      >
                        <Camera size={24} className="text-whatsapp-primary" />
                        <span className="text-xs text-whatsapp-dark font-medium">מצלמה</span>
                      </button>
                    </div>
                    <p className="text-xs text-face-muted text-center">
                      או גרור תמונות לכאן
                    </p>
                    <p className="text-[10px] text-face-muted mt-1">
                      {formData.images.length}/{MAX_IMAGES} תמונות | PNG, JPG עד 5MB
                    </p>
                  </div>
                )}

                {/* Hidden file inputs */}
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    const remainingSlots = MAX_IMAGES - formData.images.length;
                    files.slice(0, remainingSlots).forEach(file => handleImageUpload(file));
                    e.target.value = '';
                  }}
                  className="hidden"
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageUpload(file);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-bold text-face-muted block mb-1">
              הערות נוספות
              <span className={`float-left ${formData.notes.length > 900 ? 'text-red-500' : 'text-face-muted'}`}>
                {formData.notes.length}/1000
              </span>
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => {
                if (e.target.value.length <= 1000) {
                  setFormData({ ...formData, notes: e.target.value });
                }
              }}
              placeholder="תיאור קצר, שירותים מיוחדים..."
              rows={3}
              maxLength={1000}
              className="w-full px-3 py-2 border border-face-border rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp-primary resize-none"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={isSubmitting || !formData.name || !formData.phone || !formData.location}
              className="flex-1 bg-whatsapp-primary text-white py-3 rounded-lg font-bold hover:bg-whatsapp-dark transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
              {isSubmitting ? 'שומר...' : 'סיום רישום'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-6 py-3 rounded-lg font-bold border border-face-border hover:bg-neutral-50 transition-all"
            >
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// New Request Form Component
interface NewRequestFormProps {
  onSubmit: (data: Omit<CustomerRequest, 'id'>) => void;
  onCancel: () => void;
}

function NewRequestForm({ onSubmit, onCancel }: NewRequestFormProps) {
  const [formData, setFormData] = useState({
    customerName: '',
    locationPref: '',
    dates: '',
    roomsNeeded: 2,
    bedsNeeded: 4,
    budget: '',
    contactInfo: '',
    notes: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined });

  // Update dates string when date range changes
  const handleDateRangeSelect = (range: { from: Date | undefined; to: Date | undefined } | undefined) => {
    if (!range) {
      setDateRange({ from: undefined, to: undefined });
      setFormData({ ...formData, dates: '' });
      return;
    }
    setDateRange(range);
    if (range.from && range.to) {
      const fromStr = format(range.from, 'dd/MM/yyyy', { locale: he });
      const toStr = format(range.to, 'dd/MM/yyyy', { locale: he });
      setFormData({ ...formData, dates: `${fromStr} - ${toStr}` });
      setShowDatePicker(false);
    } else if (range.from) {
      const fromStr = format(range.from, 'dd/MM/yyyy', { locale: he });
      setFormData({ ...formData, dates: fromStr });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.customerName || !formData.dates) return;

    setIsSubmitting(true);
    try {
      await onSubmit(formData);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg border border-face-border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-whatsapp-dark flex items-center gap-2">
          <ClipboardList size={20} className="text-[#1877F2]" />
          ביקוש חדש
        </h3>
        <button
          onClick={onCancel}
          className="p-2 hover:bg-neutral-100 rounded-full transition-colors"
        >
          <X size={18} className="text-face-muted" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-bold text-face-muted block mb-1">שם הלקוח / מזהה *</label>
          <input
            type="text"
            value={formData.customerName}
            onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
            placeholder="לדוגמה: משפחת כהן"
            className="w-full px-3 py-2 border border-face-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
            required
          />
        </div>

        <div>
          <label className="text-xs font-bold text-face-muted block mb-1">תאריכים מבוקשים *</label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowDatePicker(!showDatePicker)}
              className={`w-full px-3 py-2 border rounded-lg text-right flex items-center justify-between transition-all ${
                showDatePicker ? 'border-[#1877F2] ring-2 ring-[#1877F2]' : 'border-face-border'
              } ${formData.dates ? 'text-face-text' : 'text-face-muted'}`}
            >
              <span>{formData.dates || 'לחץ לבחירת תאריכים'}</span>
              <CalendarIcon size={18} className="text-[#1877F2]" />
            </button>

            <AnimatePresence>
              {showDatePicker && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute z-50 mt-2 bg-white rounded-xl shadow-xl border border-face-border p-3"
                >
                  <DayPicker
                    mode="range"
                    selected={dateRange}
                    onSelect={handleDateRangeSelect}
                    locale={he}
                    dir="rtl"
                    disabled={{ before: new Date() }}
                    numberOfMonths={1}
                    showOutsideDays
                  />
                  <div className="flex justify-between items-center mt-2 pt-2 border-t border-face-border">
                    <button
                      type="button"
                      onClick={() => {
                        setDateRange({ from: undefined, to: undefined });
                        setFormData({ ...formData, dates: '' });
                      }}
                      className="text-xs text-red-500 hover:text-red-600"
                    >
                      נקה
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDatePicker(false)}
                      className="text-xs text-[#1877F2] font-bold"
                    >
                      סגור
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-face-muted block mb-1">איזור מבוקש</label>
          <input
            type="text"
            value={formData.locationPref}
            onChange={(e) => setFormData({ ...formData, locationPref: e.target.value })}
            placeholder="לדוגמה: גליל עליון, צפון"
            className="w-full px-3 py-2 border border-face-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-face-muted block mb-1">חדרים</label>
            <input
              type="number"
              min="1"
              max="50"
              value={formData.roomsNeeded}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 1;
                setFormData({ ...formData, roomsNeeded: Math.max(1, Math.min(50, val)) });
              }}
              className="w-full px-3 py-2 border border-face-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-face-muted block mb-1">מיטות</label>
            <input
              type="number"
              min="1"
              max="100"
              value={formData.bedsNeeded}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 1;
                setFormData({ ...formData, bedsNeeded: Math.max(1, Math.min(100, val)) });
              }}
              className="w-full px-3 py-2 border border-face-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-face-muted block mb-1">תקציב</label>
          <input
            type="text"
            value={formData.budget}
            onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
            placeholder="לדוגמה: עד 1500₪ ללילה"
            className="w-full px-3 py-2 border border-face-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-face-muted block mb-1">פרטי קשר</label>
          <input
            type="text"
            value={formData.contactInfo}
            onChange={(e) => setFormData({ ...formData, contactInfo: e.target.value })}
            placeholder="טלפון, מייל..."
            className="w-full px-3 py-2 border border-face-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-face-muted block mb-1">
            הערות
            <span className={`float-left ${formData.notes.length > 450 ? 'text-red-500' : 'text-face-muted'}`}>
              {formData.notes.length}/500
            </span>
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => {
              if (e.target.value.length <= 500) {
                setFormData({ ...formData, notes: e.target.value });
              }
            }}
            placeholder="דרישות מיוחדות, העדפות..."
            rows={2}
            maxLength={500}
            className="w-full px-3 py-2 border border-face-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1877F2] resize-none"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={isSubmitting || !formData.customerName || !formData.dates}
            className="flex-1 bg-[#1877F2] text-white py-2.5 rounded-lg font-bold hover:bg-[#1565c0] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
            {isSubmitting ? 'שומר...' : 'צור ביקוש'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-2.5 rounded-lg font-bold border border-face-border hover:bg-neutral-50 transition-all"
          >
            ביטול
          </button>
        </div>
      </form>
    </div>
  );
}

// Phone Actions Component
interface PhoneActionsProps {
  phone: string;
  name: string;
  compact?: boolean;
}

function PhoneActions({ phone, name, compact = false }: PhoneActionsProps) {
  const [showMenu, setShowMenu] = useState(false);
  const cleanPhone = phone.replace(/\D/g, '');
  const israelPhone = cleanPhone.startsWith('0') ? '972' + cleanPhone.slice(1) : cleanPhone;
  const messageText = encodeURIComponent(`שלום, בקשר ל${name}`);

  // Detect if Android
  const isAndroid = /android/i.test(navigator.userAgent);

  // WhatsApp URLs - Android uses intent:// to open specific app
  const whatsappRegularUrl = isAndroid
    ? `intent://send?phone=${israelPhone}&text=${messageText}#Intent;scheme=whatsapp;package=com.whatsapp;end`
    : `https://wa.me/${israelPhone}?text=${messageText}`;

  // WhatsApp Business URL
  const whatsappBusinessUrl = isAndroid
    ? `intent://send?phone=${israelPhone}&text=${messageText}#Intent;scheme=whatsapp;package=com.whatsapp.w4b;end`
    : `https://wa.me/${israelPhone}?text=${messageText}`;

  const menuContent = (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setShowMenu(false)} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl border border-face-border z-50 py-2 min-w-[200px]">
        <div className="px-4 py-2 border-b border-face-border mb-1">
          <div className="text-sm font-bold text-face-text">יצירת קשר</div>
          <div className="text-xs text-face-muted">{phone}</div>
        </div>
        <a href={`tel:${cleanPhone}`} className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 text-sm" onClick={() => setShowMenu(false)}>
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
            <Phone size={16} className="text-blue-600" />
          </div>
          <span>חיוג טלפוני</span>
        </a>
        <a href={whatsappRegularUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 text-sm" onClick={() => setShowMenu(false)}>
          <div className="w-8 h-8 rounded-full bg-[#25D366]/20 flex items-center justify-center">
            <MessageCircle size={16} className="text-[#25D366]" />
          </div>
          <span>WhatsApp</span>
        </a>
        <a href={whatsappBusinessUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 text-sm" onClick={() => setShowMenu(false)}>
          <div className="w-8 h-8 rounded-full bg-[#128C7E]/20 flex items-center justify-center">
            <MessageCircle size={16} className="text-[#128C7E]" />
          </div>
          <span>WhatsApp Business</span>
        </a>
      </div>
    </>
  );

  if (compact) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="p-2 bg-whatsapp-primary text-white rounded-full hover:bg-whatsapp-dark transition-all"
          title="אפשרויות יצירת קשר"
        >
          <Phone size={14} />
        </button>
        {showMenu && menuContent}
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-2">
      <span className="text-[11px] text-face-muted">{phone}</span>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="w-7 h-7 bg-whatsapp-primary text-white rounded-full hover:bg-whatsapp-dark transition-all flex items-center justify-center"
        title="אפשרויות יצירת קשר"
      >
        <Phone size={14} />
      </button>
      {showMenu && menuContent}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [showRoleSelection, setShowRoleSelection] = useState(false);
  const [showOwnerRegistration, setShowOwnerRegistration] = useState(false);
  const [zimmers, setZimmers] = useState<ZimmerAvailability[]>([]);
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'available' | 'requests' | 'calendar' | 'stats' | 'admin' | 'matches'>('available');
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [selectedZimmers, setSelectedZimmers] = useState<Set<string>>(new Set());
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [filterDate, setFilterDate] = useState<string>('');
  const [mainCalendarMonth, setMainCalendarMonth] = useState<Date>(new Date());
  const [selectedMainDate, setSelectedMainDate] = useState<string | null>(null);
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [guestLoadError, setGuestLoadError] = useState<string | null>(null);
  const [isCalendarConnected, setIsCalendarConnected] = useState(false);
  const [isConnectingCalendar, setIsConnectingCalendar] = useState(false);
  const [calendarEmail, setCalendarEmail] = useState<string | null>(null);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [showUnitForm, setShowUnitForm] = useState(false);
  const [editingUnit, setEditingUnit] = useState<ZimmerUnit | null>(null);
  const [expandedUnitCalendar, setExpandedUnitCalendar] = useState<string | null>(null);
  const [myZimmerCalendarMonth, setMyZimmerCalendarMonth] = useState<Date>(new Date());

  // Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    
    // Test Firestore connection
    const testConnection = async () => {
      try {
        const { getDocFromServer } = await import('firebase/firestore');
        await getDocFromServer(doc(db, '_connection_test_', 'check'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('offline')) {
          console.error("Firestore connection issue: client is offline or config invalid.");
        }
      }
    };
    testConnection();

    return () => unsubscribe();
  }, []);

  // Initialize Google Calendar API and check connection status
  useEffect(() => {
    const checkCalendarStatus = async () => {
      try {
        await initGoogleCalendar();
        const connected = isCalendarSignedIn();
        setIsCalendarConnected(connected);
        if (connected) {
          setCalendarEmail(getCalendarUserEmail());
        }
      } catch (error) {
        console.log('Google Calendar not initialized yet');
      }
    };

    if (user && userProfile?.role === 'owner') {
      checkCalendarStatus();
    }
  }, [user, userProfile?.role]);

  // Load user profile
  useEffect(() => {
    if (!user) {
      setUserProfile(null);
      setShowRoleSelection(false);
      setShowOwnerRegistration(false);
      setProfileLoadError(null);
      return;
    }

    const loadProfile = async () => {
      setIsProfileLoading(true);
      setProfileLoadError(null);
      try {
        const profileDoc = await getDoc(doc(db, 'users', user.uid));
        if (profileDoc.exists()) {
          const data = profileDoc.data() as UserProfile;
          setUserProfile(data);

          // If owner but no zimmer registered, show registration
          if (data.role === 'owner' && !data.zimmerDetails) {
            setShowOwnerRegistration(true);
          }
        } else {
          // Admin auto-assigns
          if (user.email === '3290667@gmail.com') {
            const adminProfile: UserProfile = {
              uid: user.uid,
              email: user.email!,
              displayName: user.displayName || undefined,
              role: 'admin',
              createdAt: new Date().toISOString()
            };
            await setDoc(doc(db, 'users', user.uid), adminProfile);
            setUserProfile(adminProfile);
          } else {
            // First time user - show role selection
            setShowRoleSelection(true);
          }
        }
      } catch (error) {
        console.error('Error loading profile:', error);
        const errorMsg = error instanceof Error ? error.message : 'שגיאה לא ידועה';
        setProfileLoadError(`שגיאה בטעינת הפרופיל: ${errorMsg}`);
      } finally {
        setIsProfileLoading(false);
      }
    };

    loadProfile();
  }, [user]);

  // Handle role selection
  const handleRoleSelection = async (role: UserRole) => {
    if (!user) return;

    const profile: UserProfile = {
      uid: user.uid,
      email: user.email!,
      displayName: user.displayName || undefined,
      role,
      createdAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'users', user.uid), profile);
      setUserProfile(profile);
      setShowRoleSelection(false);

      // If owner, show registration form
      if (role === 'owner') {
        setShowOwnerRegistration(true);
      }
    } catch (error) {
      console.error('Error saving profile:', error);
    }
  };

  // Handle owner registration
  const handleOwnerRegistration = async (zimmerDetails: UserProfile['zimmerDetails']) => {
    if (!user || !userProfile) return;

    try {
      const updatedProfile = { ...userProfile, zimmerDetails };
      await updateDoc(doc(db, 'users', user.uid), { zimmerDetails });
      setUserProfile(updatedProfile);
      setShowOwnerRegistration(false);

      // Also create a zimmer for this owner
      console.log('[handleOwnerRegistration] Creating zimmer with images:', zimmerDetails!.images);
      await addDoc(collection(db, 'zimmers'), {
        ownerUid: user.uid,
        name: zimmerDetails!.name,
        location: zimmerDetails!.location,
        rooms: zimmerDetails!.rooms,
        beds: zimmerDetails!.beds,
        contactInfo: zimmerDetails!.phone,
        notes: zimmerDetails!.notes || '',
        logo: zimmerDetails!.logo || '',
        images: zimmerDetails!.images || [],
        dates: 'פנוי',
        updatedAt: serverTimestamp()
      });
      console.log('[handleOwnerRegistration] Zimmer created successfully');
    } catch (error) {
      console.error('Error saving zimmer details:', error);
    }
  };

  // Handle switching from customer to owner
  const handleSwitchToOwner = async () => {
    if (!user || !userProfile) return;

    try {
      await updateDoc(doc(db, 'users', user.uid), { role: 'owner' });
      setUserProfile({ ...userProfile, role: 'owner' });
      setShowProfileMenu(false);
      setShowOwnerRegistration(true);
    } catch (error) {
      console.error('Error switching role:', error);
    }
  };

  // Handle profile update (edit existing)
  const handleProfileUpdate = async (zimmerDetails: UserProfile['zimmerDetails']) => {
    if (!user || !userProfile) return;

    try {
      const updatedProfile = { ...userProfile, zimmerDetails };
      await updateDoc(doc(db, 'users', user.uid), { zimmerDetails });
      setUserProfile(updatedProfile);
      setShowEditProfile(false);

      // Also update the zimmer in zimmers collection
      console.log('[handleProfileUpdate] Looking for zimmer with ownerUid:', user.uid);
      console.log('[handleProfileUpdate] Available zimmers:', zimmers.map(z => ({ id: z.id, name: z.name, ownerUid: z.ownerUid })));
      const userZimmer = zimmers.find(z => z.ownerUid === user.uid);
      console.log('[handleProfileUpdate] Found userZimmer:', userZimmer ? userZimmer.id : 'NOT FOUND');
      console.log('[handleProfileUpdate] Updating with images:', zimmerDetails?.images);
      if (userZimmer && zimmerDetails) {
        await updateDoc(doc(db, 'zimmers', userZimmer.id), {
          name: zimmerDetails.name,
          location: zimmerDetails.location,
          rooms: zimmerDetails.rooms,
          beds: zimmerDetails.beds,
          contactInfo: zimmerDetails.phone,
          notes: zimmerDetails.notes || '',
          logo: zimmerDetails.logo || '',
          images: zimmerDetails.images || [],
          updatedAt: serverTimestamp()
        });
        console.log('[handleProfileUpdate] Zimmer updated successfully');
      }
    } catch (error) {
      console.error('Error updating profile:', error);
    }
  };

  // Sync Zimmers from Firestore (also for guests)
  useEffect(() => {
    console.log('[ZimmerSync] useEffect triggered - user:', !!user, 'isGuestMode:', isGuestMode);
    setGuestLoadError(null);
    if (!user && !isGuestMode) {
      console.log('[ZimmerSync] No user and not guest mode, clearing zimmers');
      setZimmers([]);
      return;
    }
    console.log('[ZimmerSync] Starting to listen for zimmers...');
    const q = query(collection(db, 'zimmers'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => {
        const docData = doc.data();
        console.log('[ZimmerSync] Raw zimmer:', doc.id, {
          name: docData.name,
          ownerUid: docData.ownerUid,
          logo: docData.logo ? 'YES' : 'NO',
          images: docData.images,
          imagesCount: docData.images?.length || 0
        });
        return { id: doc.id, ...docData } as ZimmerAvailability;
      });
      console.log('[ZimmerSync] Loaded', data.length, 'zimmers');
      setZimmers(data);
      setGuestLoadError(null);
    }, (error) => {
      console.error('[ZimmerSync] Error loading zimmers:', error);
      // Show error for guests
      if (isGuestMode) {
        setGuestLoadError('שגיאה בטעינת הצימרים. נסה להתחבר עם חשבון Google.');
      }
      // Don't throw for guests
      if (user) handleFirestoreError(error, OperationType.LIST, 'zimmers');
    });
    return () => unsubscribe();
  }, [user, isGuestMode]);

  // Sync Requests from Firestore and auto-remove duplicates
  useEffect(() => {
    if (!user) {
      setRequests([]);
      return;
    }
    const q = query(collection(db, 'requests'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CustomerRequest));
      setRequests(data);

      // Auto-remove duplicates (only admin can do this)
      if (user.email === '3290667@gmail.com') {
        const duplicates = findDuplicateRequests(data);
        if (duplicates.size > 0) {
          console.log('[ZimmerSync] Found duplicates, removing...');
          for (const [, dupeIds] of duplicates) {
            for (const dupeId of dupeIds) {
              try {
                await deleteDoc(doc(db, 'requests', dupeId));
                console.log(`[ZimmerSync] Removed duplicate: ${dupeId}`);
              } catch (e) {
                console.error('Error removing duplicate:', e);
              }
            }
          }
        }
      }
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'requests'));
    return () => unsubscribe();
  }, [user]);

  // Sync logos from user profiles to zimmers (one-time migration)
  useEffect(() => {
    console.log('[Logo Sync] Checking...', {
      hasUser: !!user,
      hasProfile: !!userProfile,
      hasLogo: !!userProfile?.zimmerDetails?.logo,
      zimmersCount: zimmers.length
    });

    if (!user || !userProfile?.zimmerDetails?.logo || zimmers.length === 0) return;

    const myZimmer = zimmers.find(z => z.ownerUid === user.uid);
    console.log('[Logo Sync] My zimmer:', myZimmer?.name, 'has logo:', myZimmer?.logo);

    if (myZimmer && !myZimmer.logo && userProfile.zimmerDetails.logo) {
      console.log('[Logo Sync] Syncing logo to zimmer...');
      // Update zimmer with logo from profile
      const updates: Record<string, unknown> = {
        logo: userProfile.zimmerDetails.logo,
        updatedAt: serverTimestamp()
      };
      // Also sync images if available
      if (userProfile.zimmerDetails.images?.length) {
        updates.images = userProfile.zimmerDetails.images;
      }
      updateDoc(doc(db, 'zimmers', myZimmer.id), updates)
        .then(() => console.log('[Logo Sync] Done!'))
        .catch(console.error);
    }
  }, [user, userProfile, zimmers]);

  const handleImport = async () => {
    if (!importText.trim() || !user) return;
    setIsImporting(true);
    try {
      const parsed = await parseWhatsAppText(importText);

      // Import based on current active tab
      let batchPromises: Promise<any>[] = [];

      if (activeTab === 'available') {
        // Import as zimmers when on available tab
        batchPromises = parsed.requests.map(r => addDoc(collection(db, 'zimmers'), {
          name: r.customerName || 'צימר חדש',
          location: r.locationPref || '',
          dates: r.dates || '',
          rooms: r.roomsNeeded || 0,
          beds: r.bedsNeeded || 0,
          price: r.budget || '',
          contactInfo: r.contactInfo || '',
          notes: r.notes || '',
          ownerUid: user.uid,
          updatedAt: serverTimestamp(),
          disabledDates: []
        }));
      } else {
        // Import as requests (default for requests tab and others)
        batchPromises = parsed.requests.map(r => addDoc(collection(db, 'requests'), {
          ...r,
          createdBy: user.uid,
          updatedAt: serverTimestamp()
        }));
      }

      await Promise.all(batchPromises);
      setIsImportModalOpen(false);
      setImportText('');
    } catch (error) {
      console.error(error);
      alert('תקלה בייבוא הנתונים. וודא שאתה מחובר ונסה שוב.');
    } finally {
      setIsImporting(false);
    }
  };

  const deleteZimmer = async (id: string) => {
    const zimmer = zimmers.find(z => z.id === id);
    const confirmMsg = zimmer ? `האם אתה בטוח שברצונך למחוק את "${zimmer.name}"?` : 'האם אתה בטוח שברצונך למחוק את הצימר?';
    if (!window.confirm(confirmMsg)) return;
    try {
      await deleteDoc(doc(db, 'zimmers', id));
    } catch (e) { handleFirestoreError(e, OperationType.DELETE, `zimmers/${id}`); }
  };

  const deleteRequest = async (id: string) => {
    const request = requests.find(r => r.id === id);
    const confirmMsg = request ? `האם אתה בטוח שברצונך למחוק את הביקוש של "${request.customerName}"?` : 'האם אתה בטוח שברצונך למחוק את הביקוש?';
    if (!window.confirm(confirmMsg)) return;
    try {
      await deleteDoc(doc(db, 'requests', id));
    } catch (e) { handleFirestoreError(e, OperationType.DELETE, `requests/${id}`); }
  };

  const updateZimmer = async (id: string, updates: Partial<ZimmerAvailability>) => {
    try {
      // Remove id and ownerUid from updates to be safe
      const { id: _, ownerUid, ...cleanUpdates } = updates as any;

      // Sanitize string fields
      const sanitizedUpdates: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (cleanUpdates.name !== undefined) sanitizedUpdates.name = sanitizeForDisplay(cleanUpdates.name);
      if (cleanUpdates.location !== undefined) sanitizedUpdates.location = sanitizeForDisplay(cleanUpdates.location);
      if (cleanUpdates.dates !== undefined) sanitizedUpdates.dates = sanitizeForDisplay(cleanUpdates.dates);
      if (cleanUpdates.price !== undefined) sanitizedUpdates.price = sanitizeForDisplay(cleanUpdates.price);
      if (cleanUpdates.contactInfo !== undefined) sanitizedUpdates.contactInfo = sanitizePhone(cleanUpdates.contactInfo);
      if (cleanUpdates.notes !== undefined) sanitizedUpdates.notes = sanitizeForDisplay(cleanUpdates.notes).slice(0, 1000);
      if (cleanUpdates.rooms !== undefined) sanitizedUpdates.rooms = Math.max(0, Math.min(100, cleanUpdates.rooms));
      if (cleanUpdates.beds !== undefined) sanitizedUpdates.beds = Math.max(0, Math.min(100, cleanUpdates.beds));
      // Pass through non-string fields as-is
      if (cleanUpdates.dateStatuses !== undefined) sanitizedUpdates.dateStatuses = cleanUpdates.dateStatuses;
      if (cleanUpdates.disabledDates !== undefined) sanitizedUpdates.disabledDates = cleanUpdates.disabledDates;
      if (cleanUpdates.logo !== undefined) sanitizedUpdates.logo = cleanUpdates.logo;

      await updateDoc(doc(db, 'zimmers', id), sanitizedUpdates);
      console.log('[ZimmerSync] Zimmer updated successfully:', id);
    } catch (e) {
      console.error('[ZimmerSync] Failed to update zimmer:', e);
      alert('שגיאה בשמירת השינויים. נסה שוב.');
      handleFirestoreError(e, OperationType.UPDATE, `zimmers/${id}`);
    }
  };

  const updateRequest = async (id: string, updates: Partial<CustomerRequest>) => {
    try {
      const { id: _, createdBy, claimedBy, ...cleanUpdates } = updates as any;

      // Sanitize string fields
      const sanitizedUpdates: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (cleanUpdates.customerName) sanitizedUpdates.customerName = sanitizeForDisplay(cleanUpdates.customerName);
      if (cleanUpdates.dates) sanitizedUpdates.dates = sanitizeForDisplay(cleanUpdates.dates);
      if (cleanUpdates.locationPref !== undefined) sanitizedUpdates.locationPref = sanitizeForDisplay(cleanUpdates.locationPref);
      if (cleanUpdates.budget !== undefined) sanitizedUpdates.budget = sanitizeForDisplay(cleanUpdates.budget);
      if (cleanUpdates.contactInfo !== undefined) sanitizedUpdates.contactInfo = sanitizePhone(cleanUpdates.contactInfo);
      if (cleanUpdates.notes !== undefined) sanitizedUpdates.notes = sanitizeForDisplay(cleanUpdates.notes).slice(0, 500);
      if (cleanUpdates.roomsNeeded !== undefined) sanitizedUpdates.roomsNeeded = Math.max(0, Math.min(100, cleanUpdates.roomsNeeded));
      if (cleanUpdates.bedsNeeded !== undefined) sanitizedUpdates.bedsNeeded = Math.max(0, Math.min(100, cleanUpdates.bedsNeeded));

      // Keep claimedBy if it exists in updates (for claim/unclaim)
      if ('claimedBy' in updates) {
        sanitizedUpdates.claimedBy = updates.claimedBy;
      }

      await updateDoc(doc(db, 'requests', id), sanitizedUpdates);
      console.log('[ZimmerSync] Request updated successfully:', id);
    } catch (e) {
      console.error('[ZimmerSync] Failed to update request:', e);
      alert('שגיאה בשמירת השינויים. נסה שוב.');
      handleFirestoreError(e, OperationType.UPDATE, `requests/${id}`);
    }
  };

  const createRequest = async (requestData: Omit<CustomerRequest, 'id'>) => {
    if (!user) return;
    try {
      // Sanitize input data before saving
      const sanitizedData = {
        customerName: sanitizeForDisplay(requestData.customerName || ''),
        dates: sanitizeForDisplay(requestData.dates || ''),
        roomsNeeded: Math.max(0, Math.min(100, requestData.roomsNeeded || 1)),
        bedsNeeded: Math.max(0, Math.min(100, requestData.bedsNeeded || 1)),
        locationPref: sanitizeForDisplay(requestData.locationPref || ''),
        budget: sanitizeForDisplay(requestData.budget || ''),
        contactInfo: sanitizePhone(requestData.contactInfo || ''),
        notes: sanitizeForDisplay(requestData.notes || '').slice(0, 500),
        createdBy: user.uid,
        updatedAt: serverTimestamp()
      };
      await addDoc(collection(db, 'requests'), sanitizedData);
      setShowNewRequest(false);
    } catch (e) { handleFirestoreError(e, OperationType.CREATE, 'requests'); }
  };

  // Unit management functions
  const addUnit = async (zimmerId: string, unitData: Omit<ZimmerUnit, 'id'>) => {
    const zimmer = zimmers.find(z => z.id === zimmerId);
    if (!zimmer) return;
    if ((zimmer.units?.length || 0) >= 5) {
      alert('ניתן להוסיף עד 5 יחידות נופש');
      return;
    }
    const newUnit: ZimmerUnit = {
      id: `unit_${Date.now()}`,
      name: sanitizeForDisplay(unitData.name),
      beds: Math.max(1, Math.min(50, unitData.beds)),
      rooms: Math.max(1, Math.min(20, unitData.rooms)),
      price: unitData.price ? sanitizeForDisplay(unitData.price) : undefined,
      notes: unitData.notes ? sanitizeForDisplay(unitData.notes).slice(0, 500) : undefined,
      dateStatuses: {}
    };
    const updatedUnits = [...(zimmer.units || []), newUnit];
    await updateZimmer(zimmerId, { units: updatedUnits } as Partial<ZimmerAvailability>);
    setShowUnitForm(false);
    setEditingUnit(null);
  };

  const updateUnit = async (zimmerId: string, unitId: string, updates: Partial<ZimmerUnit>) => {
    const zimmer = zimmers.find(z => z.id === zimmerId);
    if (!zimmer || !zimmer.units) return;
    const updatedUnits = zimmer.units.map(unit => {
      if (unit.id !== unitId) return unit;
      return {
        ...unit,
        name: updates.name ? sanitizeForDisplay(updates.name) : unit.name,
        beds: updates.beds !== undefined ? Math.max(1, Math.min(50, updates.beds)) : unit.beds,
        rooms: updates.rooms !== undefined ? Math.max(1, Math.min(20, updates.rooms)) : unit.rooms,
        price: updates.price !== undefined ? (updates.price ? sanitizeForDisplay(updates.price) : undefined) : unit.price,
        notes: updates.notes !== undefined ? (updates.notes ? sanitizeForDisplay(updates.notes).slice(0, 500) : undefined) : unit.notes,
        dateStatuses: updates.dateStatuses !== undefined ? updates.dateStatuses : unit.dateStatuses
      };
    });
    await updateZimmer(zimmerId, { units: updatedUnits } as Partial<ZimmerAvailability>);
    setShowUnitForm(false);
    setEditingUnit(null);
  };

  const deleteUnit = async (zimmerId: string, unitId: string) => {
    const zimmer = zimmers.find(z => z.id === zimmerId);
    if (!zimmer || !zimmer.units) return;
    if (!window.confirm('האם אתה בטוח שברצונך למחוק יחידה זו?')) return;
    const updatedUnits = zimmer.units.filter(unit => unit.id !== unitId);
    await updateZimmer(zimmerId, { units: updatedUnits } as Partial<ZimmerAvailability>);
  };

  const updateUnitDateStatus = async (zimmerId: string, unitId: string, date: string, status: DateStatus) => {
    const zimmer = zimmers.find(z => z.id === zimmerId);
    if (!zimmer || !zimmer.units) return;
    const updatedUnits = zimmer.units.map(unit => {
      if (unit.id !== unitId) return unit;
      const newStatuses = { ...(unit.dateStatuses || {}), [date]: status };
      // Remove 'available' entries to keep data clean
      if (status === 'available') delete newStatuses[date];
      return { ...unit, dateStatuses: newStatuses };
    });
    await updateZimmer(zimmerId, { units: updatedUnits } as Partial<ZimmerAvailability>);
  };

  // Claim or unclaim a request
  const toggleClaimRequest = async (requestId: string) => {
    if (!user || !userProfile || userProfile.role !== 'owner') {
      console.log('[ZimmerSync] Cannot claim - user:', !!user, 'profile:', !!userProfile, 'role:', userProfile?.role);
      return;
    }

    const request = requests.find(r => r.id === requestId);
    if (!request) {
      console.log('[ZimmerSync] Request not found:', requestId);
      return;
    }

    try {
      if (request.claimedBy?.uid === user.uid) {
        // Unclaim
        console.log('[ZimmerSync] Unclaiming request:', requestId);
        await updateDoc(doc(db, 'requests', requestId), {
          claimedBy: deleteField(),
          updatedAt: serverTimestamp()
        });
      } else if (!request.claimedBy) {
        // Claim only if not already claimed by someone else
        console.log('[ZimmerSync] Claiming request:', requestId);
        await updateDoc(doc(db, 'requests', requestId), {
          claimedBy: {
            uid: user.uid,
            name: userProfile.zimmerDetails?.name || user.displayName || 'בעל צימר',
            logo: userProfile.zimmerDetails?.logo || '',
            claimedAt: new Date().toISOString()
          },
          updatedAt: serverTimestamp()
        });
      }
    } catch (e) {
      console.error('[ZimmerSync] Claim error:', e);
      handleFirestoreError(e, OperationType.UPDATE, `requests/${requestId}`);
    }
  };

  // Check if zimmer has any availability
  const hasAvailability = (zimmer: ZimmerAvailability): boolean => {
    const statuses = zimmer.dateStatuses || {};
    const today = new Date();
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 2);

    // Check dates in next 2 months
    let hasAvailable = false;
    const dateRange = eachDayOfInterval({ start: today, end: nextMonth });

    for (const date of dateRange) {
      const dateKey = format(date, 'yyyy-MM-dd');
      const status = statuses[dateKey];
      if (!status || status === 'available') {
        hasAvailable = true;
        break;
      }
    }

    return hasAvailable;
  };

  // Get unit status for a specific date
  const getUnitStatusForDate = (unit: ZimmerUnit, dateKey: string): DateStatus => {
    if (unit.dateStatuses && unit.dateStatuses[dateKey]) {
      return unit.dateStatuses[dateKey];
    }
    return 'available';
  };

  // Get zimmer status for a specific date (checks units if present)
  const getZimmerStatusForDate = (zimmer: ZimmerAvailability, dateKey: string): DateStatus => {
    // If zimmer has units, check if any unit is available
    if (zimmer.units && zimmer.units.length > 0) {
      let hasAvailable = false;
      let hasMaybe = false;
      for (const unit of zimmer.units) {
        const unitStatus = getUnitStatusForDate(unit, dateKey);
        if (unitStatus === 'available') hasAvailable = true;
        if (unitStatus === 'maybe') hasMaybe = true;
      }
      if (hasAvailable) return 'available';
      if (hasMaybe) return 'maybe';
      return 'occupied';
    }

    // Fallback to zimmer-level status (for zimmers without units)
    if (zimmer.dateStatuses && zimmer.dateStatuses[dateKey]) {
      return zimmer.dateStatuses[dateKey];
    }
    if (zimmer.disabledDates?.includes(dateKey)) {
      return 'occupied';
    }
    return 'available';
  };

  // Get available units for a zimmer on a specific date
  const getAvailableUnitsForDate = (zimmer: ZimmerAvailability, dateKey: string): { unit: ZimmerUnit; status: DateStatus }[] => {
    if (!zimmer.units || zimmer.units.length === 0) return [];
    return zimmer.units
      .map(unit => ({ unit, status: getUnitStatusForDate(unit, dateKey) }))
      .filter(({ status }) => status !== 'occupied');
  };

  // Filter zimmers based on user role and date filter
  const filteredZimmers = useMemo(() => {
    console.log('[ZimmerSync] Filtering zimmers - total:', zimmers.length, 'isGuestMode:', isGuestMode);
    let result = zimmers.filter(z => {
      const matchesSearch = z.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        z.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
        z.dates.toLowerCase().includes(searchQuery.toLowerCase());

      // Guests and customers only see available zimmers
      if (isGuestMode || userProfile?.role === 'customer') {
        const available = hasAvailability(z);
        if (!available) {
          console.log('[ZimmerSync] Zimmer filtered out (no availability):', z.name);
        }
        return matchesSearch && available;
      }

      return matchesSearch;
    });
    console.log('[ZimmerSync] After filtering:', result.length, 'zimmers');

    // If date filter is active, filter and sort by availability
    if (filterDate) {
      const dateKey = filterDate; // Already in yyyy-MM-dd format from input

      // Filter out occupied zimmers
      result = result.filter(z => {
        const status = getZimmerStatusForDate(z, dateKey);
        return status !== 'occupied';
      });

      // Sort: available first, then maybe
      result.sort((a, b) => {
        const statusA = getZimmerStatusForDate(a, dateKey);
        const statusB = getZimmerStatusForDate(b, dateKey);

        if (statusA === 'available' && statusB === 'maybe') return -1;
        if (statusA === 'maybe' && statusB === 'available') return 1;
        return 0;
      });
    }

    return result;
  }, [zimmers, searchQuery, userProfile?.role, filterDate, isGuestMode]);

  const filteredRequests = requests.filter(r =>
    r.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.locationPref?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
    r.dates.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Find matching requests for zimmer owner
  const myMatches = useMemo(() => {
    if (!user || userProfile?.role !== 'owner') return [];

    // Find owner's zimmer
    const myZimmer = zimmers.find(z => z.ownerUid === user.uid);
    if (!myZimmer) return [];

    // Find requests that match this zimmer
    const matches: { request: CustomerRequest; score: number; matchDetails: { locationMatch: boolean; roomsMatch: boolean; bedsMatch: boolean; datesOverlap: boolean } }[] = [];

    for (const request of requests) {
      // Skip requests that are already claimed
      if (request.claimedBy) continue;

      // Skip past requests
      if (isDateRangePast(request.dates)) continue;

      const locationMatch = checkLocationMatch(myZimmer.location, request.locationPref);
      const roomsMatch = myZimmer.rooms >= request.roomsNeeded;
      const bedsMatch = myZimmer.beds >= request.bedsNeeded;
      const datesOverlap = checkDatesOverlap(myZimmer.dates, request.dates);

      // Check if zimmer is available on requested dates
      const requestedDates = parseDateRange(request.dates);
      const availability = isZimmerAvailableOnDates(myZimmer, requestedDates);

      // Skip if zimmer is occupied on those dates
      if (!availability.available) continue;

      // Calculate score
      let score = 0;
      if (locationMatch) score += 30;
      if (roomsMatch) score += 25;
      if (bedsMatch) score += 25;
      if (datesOverlap) score += 20;
      if (myZimmer.rooms === request.roomsNeeded) score += 5;
      if (myZimmer.beds === request.bedsNeeded) score += 5;
      if (availability.status === 'maybe') score -= 10;

      // Only include if at least 50% match
      if (score >= 50) {
        matches.push({
          request,
          score: Math.min(score, 100),
          matchDetails: { locationMatch, roomsMatch, bedsMatch, datesOverlap }
        });
      }
    }

    // Sort by score descending
    return matches.sort((a, b) => b.score - a.score);
  }, [user, userProfile?.role, zimmers, requests]);

  // Admin check - uses role from profile (more secure than email check)
  const isAdmin = userProfile?.role === 'admin';

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-face-bg flex items-center justify-center">
        <Loader2 className="animate-spin text-whatsapp-primary" size={48} />
      </div>
    );
  }

  if (!user && !isGuestMode) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
        {/* Background image */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat scale-105"
          style={{ backgroundImage: 'url(/bg-login.jpeg)' }}
        />
        {/* Frosted glass overlay */}
        <div className="absolute inset-0 backdrop-blur-md bg-white/30" />
        <div className="relative bg-white/80 backdrop-blur-xl p-8 rounded-2xl shadow-2xl max-w-md w-full text-center space-y-6 border border-white/50">
          <img src="/logo.png" alt="ZimmerSync" className="w-20 h-20 rounded-full object-cover mx-auto shadow-lg" />
          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold text-whatsapp-dark tracking-tighter">ברוכים הבאים ל-ZimmerSync</h1>
            <p className="text-face-muted text-sm leading-relaxed">
              מערכת ניהול מאגר הצימרים והביקושים שלכם.
              התחברו כדי לצפות בצימרים פנויים, לעדכן יומן זמינות ולנהל לקוחות.
            </p>
          </div>
          <button
            onClick={loginWithGoogle}
            className="w-full flex items-center justify-center gap-3 bg-white border-2 border-face-border hover:bg-neutral-50 hover:border-whatsapp-primary px-6 py-4 rounded-xl font-bold transition-all shadow-md hover:shadow-lg active:scale-[0.98]"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-6 h-6" referrerPolicy="no-referrer" />
            <span className="text-base">התחברות באמצעות Google</span>
          </button>
          <button
            onClick={() => setIsGuestMode(true)}
            className="w-full bg-gradient-to-r from-whatsapp-primary to-whatsapp-dark text-white py-3.5 rounded-xl font-bold transition-all shadow-md hover:shadow-lg hover:opacity-90 active:scale-[0.98]"
          >
            כניסה כאורח לצפייה בצימרים
          </button>
        </div>
      </div>
    );
  }

  // Loading profile (only for logged-in users)
  if (isProfileLoading && !isGuestMode) {
    return (
      <div className="min-h-screen bg-face-bg flex items-center justify-center flex-col gap-4">
        <Loader2 className="animate-spin text-whatsapp-primary" size={48} />
        <p className="text-face-muted">טוען פרופיל...</p>
      </div>
    );
  }

  // Profile load error
  if (profileLoadError && !isGuestMode) {
    return (
      <div className="min-h-screen bg-face-bg flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center space-y-6 border border-face-border">
          <div className="text-5xl">⚠️</div>
          <div className="space-y-2">
            <h1 className="text-xl font-extrabold text-face-text">שגיאה בטעינת הפרופיל</h1>
            <p className="text-face-muted text-sm leading-relaxed">
              לא הצלחנו לטעון את הפרופיל שלך. ייתכן שיש בעיית חיבור.
            </p>
          </div>
          <details className="text-right bg-red-50 p-3 rounded-lg">
            <summary className="cursor-pointer text-sm text-red-600 font-bold">פרטי השגיאה</summary>
            <p className="text-xs text-red-700 mt-2 break-words">{profileLoadError}</p>
          </details>
          <div className="flex gap-3">
            <button
              onClick={() => window.location.reload()}
              className="flex-1 py-3 bg-whatsapp-primary text-white rounded-xl font-bold hover:bg-whatsapp-dark transition-all"
            >
              נסה שוב
            </button>
            <button
              onClick={() => { signOut(auth); setProfileLoadError(null); }}
              className="flex-1 py-3 bg-neutral-100 text-face-text rounded-xl font-bold hover:bg-neutral-200 transition-all"
            >
              התנתק
            </button>
          </div>
          <button
            onClick={() => setIsGuestMode(true)}
            className="w-full text-sm text-face-muted hover:text-whatsapp-primary transition-all"
          >
            או המשך כאורח לצפייה בצימרים
          </button>
        </div>
      </div>
    );
  }

  // Role Selection Modal (only for logged-in users)
  if (showRoleSelection && !isGuestMode) {
    return (
      <div className="min-h-screen bg-face-bg flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-lg w-full text-center space-y-6 border border-face-border">
          <img src="/logo.png" alt="ZimmerSync" className="w-16 h-16 rounded-full object-cover mx-auto shadow-lg" />
          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold text-whatsapp-dark tracking-tighter">שלום {user.displayName?.split(' ')[0]}!</h1>
            <p className="text-face-muted text-sm leading-relaxed">
              מה מתאר אותך הכי טוב?
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => handleRoleSelection('owner')}
              className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-face-border hover:border-whatsapp-primary hover:bg-[#E1F9EB] transition-all group"
            >
              <div className="w-16 h-16 rounded-full bg-whatsapp-primary/10 flex items-center justify-center group-hover:bg-whatsapp-primary/20">
                <Home size={32} className="text-whatsapp-primary" />
              </div>
              <div>
                <div className="font-bold text-lg text-face-text">בעל צימר</div>
                <p className="text-xs text-face-muted">יש לי צימר ואני רוצה לפרסם זמינות</p>
              </div>
            </button>
            <button
              onClick={() => handleRoleSelection('customer')}
              className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-face-border hover:border-[#1877F2] hover:bg-blue-50 transition-all group"
            >
              <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center group-hover:bg-blue-200">
                <Search size={32} className="text-[#1877F2]" />
              </div>
              <div>
                <div className="font-bold text-lg text-face-text">לקוח</div>
                <p className="text-xs text-face-muted">מחפש צימר פנוי</p>
              </div>
            </button>
          </div>
          <button
            onClick={() => signOut(auth)}
            className="text-sm text-face-muted hover:text-red-500 transition-colors"
          >
            התנתק
          </button>
        </div>
      </div>
    );
  }

  // Owner Registration Form
  if (showOwnerRegistration) {
    return <OwnerRegistrationForm user={user} onSubmit={handleOwnerRegistration} onCancel={() => signOut(auth)} />;
  }

  // Edit Profile Form
  if (showEditProfile && userProfile?.zimmerDetails) {
    return (
      <OwnerRegistrationForm
        user={user}
        onSubmit={handleProfileUpdate}
        onCancel={() => setShowEditProfile(false)}
        initialData={userProfile.zimmerDetails}
      />
    );
  }

  return (
    <div className="min-h-screen bg-face-bg text-face-text font-sans flex flex-col">
      {/* Header */}
      <header className="h-16 bg-white border-b border-face-border sticky top-0 z-20 flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="ZimmerSync" className="w-10 h-10 rounded-full object-cover" />
          <h1 className="text-lg md:text-xl font-extrabold text-whatsapp-dark tracking-tighter truncate">
            <span className="hidden sm:inline">ZimmerSync | </span>
            ניהול מאגר צימרים פנויים
          </h1>
        </div>
        
        <div className="flex items-center gap-3 md:gap-6">
          {isGuestMode ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-face-muted">צופה כאורח</span>
              <button
                onClick={() => setIsGuestMode(false)}
                className="px-3 py-1.5 bg-whatsapp-primary text-white text-xs font-bold rounded-lg hover:bg-whatsapp-dark transition-all"
              >
                התחבר
              </button>
            </div>
          ) : (
          <div className="flex items-center gap-3 border-r border-face-border pr-3 md:pr-6 relative">
            <div className="hidden sm:block text-left">
              <div className="text-xs font-bold text-face-text leading-none mb-0.5">{user?.displayName}</div>
              <div className="text-[10px] text-face-muted leading-none">
                {userProfile?.role === 'admin' ? 'מנהל' : userProfile?.role === 'owner' ? 'בעל צימר' : 'לקוח'}
              </div>
            </div>
            <button
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="relative"
            >
              {user?.photoURL ? (
                <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border-2 border-face-border hover:border-whatsapp-primary transition-all cursor-pointer" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-neutral-200 flex items-center justify-center hover:bg-neutral-300 transition-all cursor-pointer"><User size={16} /></div>
              )}
            </button>

            {/* Profile Menu */}
            {showProfileMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowProfileMenu(false)} />
                <div className="absolute left-0 top-full mt-2 bg-white rounded-xl shadow-2xl border border-face-border z-50 py-2 min-w-[220px]">
                  <div className="px-4 py-3 border-b border-face-border">
                    <div className="font-bold text-sm">{user.displayName}</div>
                    <div className="text-xs text-face-muted">{user.email}</div>
                    <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 bg-whatsapp-primary/10 text-whatsapp-primary text-xs font-bold rounded-full">
                      {userProfile?.role === 'admin' ? 'מנהל' : userProfile?.role === 'owner' ? 'בעל צימר' : 'לקוח'}
                    </div>
                  </div>

                  {userProfile?.role === 'customer' && (
                    <button
                      onClick={handleSwitchToOwner}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 text-sm text-right"
                    >
                      <div className="w-8 h-8 rounded-full bg-whatsapp-primary/10 flex items-center justify-center">
                        <Home size={16} className="text-whatsapp-primary" />
                      </div>
                      <div>
                        <div className="font-bold">הפוך לבעל צימר</div>
                        <div className="text-xs text-face-muted">רשום את הצימר שלך</div>
                      </div>
                    </button>
                  )}

                  {userProfile?.role === 'owner' && userProfile.zimmerDetails && (
                    <div className="px-4 py-3 border-b border-face-border">
                      <div className="flex items-center gap-3">
                        {userProfile.zimmerDetails.logo ? (
                          <img
                            src={userProfile.zimmerDetails.logo}
                            alt="לוגו"
                            className="w-10 h-10 rounded-lg object-cover border border-face-border"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-whatsapp-primary/10 flex items-center justify-center">
                            <Home size={20} className="text-whatsapp-primary" />
                          </div>
                        )}
                        <div className="flex-1">
                          <div className="font-bold text-sm">{userProfile.zimmerDetails.name}</div>
                          <div className="text-xs text-face-muted">{userProfile.zimmerDetails.location}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {userProfile?.role === 'owner' && (
                    <button
                      onClick={() => { setShowEditProfile(true); setShowProfileMenu(false); }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 text-sm text-right"
                    >
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                        <Edit2 size={16} className="text-blue-600" />
                      </div>
                      <span className="font-bold">ערוך פרטי צימר</span>
                    </button>
                  )}

                  {/* Google Calendar Connection */}
                  {userProfile?.role === 'owner' && (
                    <button
                      onClick={async () => {
                        if (isCalendarConnected) {
                          await signOutFromCalendar();
                          setIsCalendarConnected(false);
                          setCalendarEmail(null);
                        } else {
                          setIsConnectingCalendar(true);
                          try {
                            const success = await signInToCalendar();
                            if (success) {
                              setIsCalendarConnected(true);
                              setCalendarEmail(getCalendarUserEmail());
                            }
                          } finally {
                            setIsConnectingCalendar(false);
                          }
                        }
                      }}
                      disabled={isConnectingCalendar}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-right ${
                        isCalendarConnected
                          ? 'hover:bg-orange-50 text-orange-600'
                          : 'hover:bg-green-50 text-green-600'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        isCalendarConnected ? 'bg-orange-100' : 'bg-green-100'
                      }`}>
                        {isConnectingCalendar ? (
                          <Loader2 size={16} className="animate-spin text-green-600" />
                        ) : (
                          <CalendarIcon size={16} className={isCalendarConnected ? 'text-orange-600' : 'text-green-600'} />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="font-bold">
                          {isCalendarConnected ? 'נתק Google Calendar' : 'חבר Google Calendar'}
                        </div>
                        {isCalendarConnected && calendarEmail && (
                          <div className="text-xs text-face-muted">{calendarEmail}</div>
                        )}
                      </div>
                      {isCalendarConnected && (
                        <div className="w-2 h-2 rounded-full bg-green-500" title="מחובר" />
                      )}
                    </button>
                  )}

                  <button
                    onClick={() => { signOut(auth); setShowProfileMenu(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-50 text-sm text-right text-red-600"
                  >
                    <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                      <LogOut size={16} className="text-red-600" />
                    </div>
                    <span className="font-bold">התנתק</span>
                  </button>
                </div>
              </>
            )}
          </div>
          )}
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 lg:overflow-hidden grid grid-cols-1 lg:grid-cols-[300px_1fr]">
        
        {/* Sidebar: Filters & Stats */}
        <aside className="bg-white border-b lg:border-l border-face-border flex flex-col lg:h-full lg:order-first z-10">
          <div className="whatsapp-panel-header lg:flex">
            <span>תפריט וסינון</span>
          </div>
          <div className="p-4 space-y-4 lg:space-y-6 overflow-y-auto max-h-[40vh] lg:max-h-none">
            {/* Customer Banner - Switch to Owner */}
            {!isGuestMode && userProfile?.role === 'customer' && (
              <div className="bg-gradient-to-r from-whatsapp-primary/10 to-emerald-50 p-3 rounded-xl border border-whatsapp-primary/30">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-whatsapp-primary/20 flex items-center justify-center shrink-0">
                    <Home size={20} className="text-whatsapp-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-face-text">יש לך צימר?</p>
                    <p className="text-[10px] text-face-muted">הפוך לבעל צימר ופרסם זמינות</p>
                  </div>
                  <button
                    onClick={handleSwitchToOwner}
                    className="px-3 py-1.5 bg-whatsapp-primary text-white text-xs font-bold rounded-lg hover:bg-whatsapp-dark transition-all shrink-0"
                  >
                    הפוך
                  </button>
                </div>
              </div>
            )}

            {/* Search */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-face-muted uppercase">חיפוש חופשי</label>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-face-muted" size={14} />
                <input 
                  type="text" 
                  placeholder="שם, מיקום, תאריך..."
                  className="w-full pr-9 pl-3 py-2 bg-neutral-50 border border-face-border rounded focus:outline-none focus:ring-1 focus:ring-whatsapp-primary text-sm"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Tabs (Mobile as horizontal buttons, Desktop as vertical list) */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-face-muted uppercase">סוג תצוגה</label>
              <div className="flex lg:flex-col gap-2 lg:gap-1">
                <button
                  onClick={() => setActiveTab('available')}
                  className={`flex-1 lg:flex-none flex items-center justify-between p-2 lg:p-3 rounded text-sm font-bold transition-all ${activeTab === 'available' ? 'bg-[#E1F9EB] text-whatsapp-dark' : 'bg-neutral-50 lg:bg-transparent hover:bg-neutral-100 text-face-muted'}`}
                >
                  <div className="flex items-center gap-2">
                    <DoorOpen size={16} />
                    <span>פנויים</span>
                  </div>
                  <span className="hidden lg:inline bg-white/50 px-2 py-0.5 rounded text-xs">{zimmers.length}</span>
                </button>
                {!isGuestMode && userProfile?.role === 'owner' && (
                  <button
                    onClick={() => setActiveTab('matches')}
                    className={`flex-1 lg:flex-none flex items-center justify-between p-2 lg:p-3 rounded text-sm font-bold transition-all ${activeTab === 'matches' ? 'bg-[#FDF2F8] text-[#DB2777]' : 'bg-neutral-50 lg:bg-transparent hover:bg-neutral-100 text-face-muted'}`}
                  >
                    <div className="flex items-center gap-2">
                      <Home size={16} />
                      <span>הצימר שלי</span>
                    </div>
                    <span className="hidden lg:inline bg-white/50 px-2 py-0.5 rounded text-xs">{myMatches.length}</span>
                  </button>
                )}
                {!isGuestMode && userProfile?.role !== 'customer' && (
                  <button
                    onClick={() => setActiveTab('requests')}
                    className={`flex-1 lg:flex-none flex items-center justify-between p-2 lg:p-3 rounded text-sm font-bold transition-all ${activeTab === 'requests' ? 'bg-[#E7F3FF] text-[#1877F2]' : 'bg-neutral-50 lg:bg-transparent hover:bg-neutral-100 text-face-muted'}`}
                  >
                    <div className="flex items-center gap-2">
                      <ClipboardList size={16} />
                      <span>ביקושים</span>
                    </div>
                    <span className="hidden lg:inline bg-white/50 px-2 py-0.5 rounded text-xs">{requests.length}</span>
                  </button>
                )}
                <button
                  onClick={() => setActiveTab('calendar')}
                  className={`flex-1 lg:flex-none flex items-center justify-between p-2 lg:p-3 rounded text-sm font-bold transition-all ${activeTab === 'calendar' ? 'bg-[#FEF3C7] text-[#D97706]' : 'bg-neutral-50 lg:bg-transparent hover:bg-neutral-100 text-face-muted'}`}
                >
                  <div className="flex items-center gap-2">
                    <CalendarIcon size={16} />
                    <span>לוח שנה</span>
                  </div>
                </button>
                {!isGuestMode && userProfile?.role !== 'customer' && (
                  <button
                    onClick={() => setActiveTab('stats')}
                    className={`flex-1 lg:flex-none flex items-center justify-between p-2 lg:p-3 rounded text-sm font-bold transition-all ${activeTab === 'stats' ? 'bg-[#F3E8FF] text-[#9333EA]' : 'bg-neutral-50 lg:bg-transparent hover:bg-neutral-100 text-face-muted'}`}
                  >
                    <div className="flex items-center gap-2">
                      <BarChart3 size={16} />
                      <span>סטטיסטיקות</span>
                    </div>
                  </button>
                )}
                {!isGuestMode && isAdmin && (
                  <button
                    onClick={() => setActiveTab('admin')}
                    className={`flex-1 lg:flex-none flex items-center justify-between p-2 lg:p-3 rounded text-sm font-bold transition-all ${activeTab === 'admin' ? 'bg-red-100 text-red-700' : 'bg-neutral-50 lg:bg-transparent hover:bg-neutral-100 text-face-muted'}`}
                  >
                    <div className="flex items-center gap-2">
                      <Settings size={16} />
                      <span>ניהול</span>
                    </div>
                  </button>
                )}
              </div>
            </div>

            </div>

          {/* Stat Bar - Sticky at bottom of sidebar on desktop, visible below filters on mobile */}
          <div className="p-3 lg:p-4 border-t border-face-border bg-[#F9FAFB] flex gap-4 mt-auto">
            <div className={`${isGuestMode || userProfile?.role === 'customer' ? 'flex-1' : 'flex-1'} text-center`}>
              <span className="block text-base lg:text-lg font-extrabold text-whatsapp-dark">{filteredZimmers.length}</span>
              <span className="text-[9px] lg:text-[10px] text-face-muted font-bold uppercase tracking-tight">
                {isGuestMode || userProfile?.role === 'customer' ? 'צימרים פנויים' : 'צימרים במאגר'}
              </span>
            </div>
            {!isGuestMode && userProfile?.role !== 'customer' && (
              <div className="flex-1 text-center border-r border-face-border">
                <span className="block text-base lg:text-lg font-extrabold text-[#1877F2]">{requests.length}</span>
                <span className="text-[9px] lg:text-[10px] text-face-muted font-bold uppercase tracking-tight">ביקושי לקוחות</span>
              </div>
            )}
          </div>
        </aside>

        {/* Results List */}
        <section className="bg-white flex flex-col lg:h-full overflow-hidden">
          <div className="whatsapp-panel-header shrink-0">
            <span>
              {activeTab === 'available' ? 'לוח זמינות - בחר תאריך לראות צימרים פנויים' :
               activeTab === 'requests' ? 'תוצאות מאגר - ביקושי לקוחות' :
               activeTab === 'calendar' ? 'לוח שנה - תפוסת צימרים' :
               activeTab === 'stats' ? 'סטטיסטיקות ותובנות' :
               activeTab === 'matches' ? 'הצימר שלי - ניהול זמינות ויחידות נופש' :
               'ניהול מערכת'}
            </span>
          </div>
          
          <div className="flex-1 lg:overflow-y-auto p-4 bg-face-bg">
            <AnimatePresence mode="wait">
              {activeTab === 'available' && (
                <motion.div
                  key="available"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="space-y-3 max-w-4xl mx-auto"
                >
                  {guestLoadError ? (
                    <div className="p-12 text-center">
                      <p className="text-red-500 text-sm mb-4">{guestLoadError}</p>
                      <button
                        onClick={() => setIsGuestMode(false)}
                        className="px-4 py-2 bg-whatsapp-primary text-white rounded-lg hover:bg-whatsapp-dark transition-all"
                      >
                        התחבר עם Google
                      </button>
                    </div>
                  ) : zimmers.length === 0 ? (
                    <div className="p-12 text-center">
                      <div className="text-5xl mb-4">🏡</div>
                      <h3 className="text-lg font-bold text-face-text mb-2">
                        אין צימרים פנויים כרגע
                      </h3>
                      <p className="text-face-muted text-sm mb-6">
                        בעלי הצימרים עדיין לא עדכנו זמינות. נסה שוב מאוחר יותר.
                      </p>
                      {userProfile?.role === 'customer' && (
                        <div className="bg-gradient-to-r from-whatsapp-primary/10 to-emerald-100 p-4 rounded-xl border border-whatsapp-primary/20">
                          <p className="text-sm text-face-text mb-3">
                            <strong>יש לך צימר?</strong> הפוך לבעל צימר ופרסם את הזמינות שלך!
                          </p>
                          <button
                            onClick={handleSwitchToOwner}
                            className="px-6 py-2 bg-whatsapp-primary text-white rounded-lg font-bold hover:bg-whatsapp-dark transition-all flex items-center gap-2 mx-auto"
                          >
                            <Home size={18} />
                            הפוך לבעל צימר
                          </button>
                        </div>
                      )}
                      {isGuestMode && (
                        <button
                          onClick={() => setIsGuestMode(false)}
                          className="mt-4 px-4 py-2 bg-whatsapp-primary text-white rounded-lg hover:bg-whatsapp-dark transition-all"
                        >
                          התחבר לקבלת עדכונים
                        </button>
                      )}
                    </div>
                  ) : (
                    <MainCalendar
                      zimmers={zimmers}
                      month={mainCalendarMonth}
                      onMonthChange={setMainCalendarMonth}
                      selectedDate={selectedMainDate}
                      onSelectDate={setSelectedMainDate}
                      getZimmerStatusForDate={getZimmerStatusForDate}
                      getAvailableUnitsForDate={getAvailableUnitsForDate}
                    />
                  )}
                </motion.div>
              )}
              {activeTab === 'requests' && (
                <motion.div
                  key="requests"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="space-y-3 max-w-4xl mx-auto"
                >
                  {/* New Request Button/Form */}
                  {showNewRequest ? (
                    <NewRequestForm onSubmit={createRequest} onCancel={() => setShowNewRequest(false)} />
                  ) : (
                    <button
                      onClick={() => setShowNewRequest(true)}
                      className="w-full py-3 bg-[#1877F2] text-white rounded-lg font-bold hover:bg-[#1565c0] transition-all flex items-center justify-center gap-2"
                    >
                      <ClipboardList size={18} />
                      פתח ביקוש חדש
                    </button>
                  )}

                  {filteredRequests.length === 0 && !showNewRequest ? (
                    <div className="p-12 text-center text-face-muted text-sm italic">אין ביקושים תואמים.</div>
                  ) : (
                    filteredRequests.map(request => (
                      <RequestCard
                        key={request.id} request={request}
                        onDelete={deleteRequest} onUpdate={updateRequest}
                        isEditing={editingId === request.id} setIsEditing={(val) => setEditingId(val ? request.id : null)}
                        zimmers={zimmers}
                        onClaim={toggleClaimRequest}
                        userRole={userProfile?.role}
                        isAdmin={isAdmin}
                      />
                    ))
                  )}
                </motion.div>
              )}
              {activeTab === 'calendar' && (
                <motion.div
                  key="calendar"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="max-w-6xl mx-auto"
                >
                  <CalendarView
                    zimmers={zimmers}
                    month={calendarMonth}
                    onMonthChange={setCalendarMonth}
                    selectedZimmers={selectedZimmers}
                    onToggleZimmer={(id) => {
                      setSelectedZimmers(prev => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      });
                    }}
                    onSelectAll={() => setSelectedZimmers(new Set(zimmers.map(z => z.id)))}
                    onClearAll={() => setSelectedZimmers(new Set())}
                    onUpdateDateStatus={async (zimmerId, date, status) => {
                      const zimmer = zimmers.find(z => z.id === zimmerId);
                      if (!zimmer) return;
                      const newStatuses = { ...(zimmer.dateStatuses || {}), [date]: status };
                      // Remove 'available' entries to keep data clean
                      if (status === 'available') delete newStatuses[date];
                      await updateZimmer(zimmerId, { dateStatuses: newStatuses });

                      // Sync to Google Calendar if connected
                      if (isCalendarConnected && zimmer.ownerUid === user?.uid) {
                        try {
                          await syncZimmerToCalendar(zimmer.name, date, status);
                          console.log('[Calendar] Synced:', date, status);
                        } catch (e) {
                          console.error('[Calendar] Sync failed:', e);
                        }
                      }
                    }}
                    currentUserId={user?.uid}
                    isAdmin={isAdmin}
                  />
                </motion.div>
              )}
              {activeTab === 'matches' && userProfile?.role === 'owner' && (
                <motion.div
                  key="matches"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="space-y-4 max-w-4xl mx-auto"
                >
                  {(() => {
                    const myZimmer = zimmers.find(z => z.ownerUid === user?.uid);
                    if (!myZimmer) {
                      return (
                        <div className="bg-amber-50 rounded-lg border border-amber-200 p-6 text-center">
                          <Home className="mx-auto mb-3 text-amber-500" size={48} />
                          <p className="text-amber-700 font-bold mb-2">לא נמצא צימר משויך לחשבון שלך</p>
                          <p className="text-amber-600 text-sm">עדכן את פרטי הצימר שלך בהגדרות הפרופיל</p>
                        </div>
                      );
                    }

                    return (
                      <>
                        {/* Zimmer Info Card */}
                        <div className="bg-gradient-to-r from-whatsapp-primary/10 to-emerald-50 rounded-lg border border-whatsapp-primary/30 p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              {myZimmer.logo && (
                                <img src={myZimmer.logo} alt={myZimmer.name} className="w-14 h-14 rounded-full object-cover border-2 border-whatsapp-primary/30" />
                              )}
                              <div>
                                <h3 className="font-bold text-lg text-face-text">{myZimmer.name}</h3>
                                <div className="text-sm text-face-muted flex flex-wrap items-center gap-2">
                                  <span className="flex items-center gap-1">
                                    <MapPin size={14} />
                                    {myZimmer.location}
                                  </span>
                                  {!myZimmer.units?.length && (
                                    <>
                                      <span>•</span>
                                      <span className="flex items-center gap-1">
                                        <DoorOpen size={14} />
                                        {myZimmer.rooms} חדרים
                                      </span>
                                      <span>•</span>
                                      <span className="flex items-center gap-1">
                                        <Bed size={14} />
                                        {myZimmer.beds} מיטות
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => setShowEditProfile(true)}
                              className="p-2 text-face-muted hover:text-whatsapp-primary hover:bg-whatsapp-primary/10 rounded-lg transition-all"
                              title="ערוך פרטי צימר"
                            >
                              <Settings size={20} />
                            </button>
                          </div>
                        </div>

                        {/* Units Section */}
                        <div className="bg-white rounded-lg border border-face-border p-4">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-face-text flex items-center gap-2">
                              <Home size={18} />
                              יחידות נופש
                            </h3>
                            {(myZimmer.units?.length || 0) < 5 && (
                              <button
                                onClick={() => { setEditingUnit(null); setShowUnitForm(true); }}
                                className="px-3 py-1.5 bg-whatsapp-primary text-white rounded-lg text-sm font-bold hover:bg-whatsapp-dark transition-all flex items-center gap-1"
                              >
                                <Plus size={16} />
                                הוסף יחידה
                              </button>
                            )}
                          </div>

                          {/* Unit Form Modal */}
                          {showUnitForm && (
                            <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                              <h4 className="font-bold text-face-text mb-3">
                                {editingUnit ? 'עריכת יחידה' : 'הוספת יחידה חדשה'}
                              </h4>
                              <UnitForm
                                initialData={editingUnit || undefined}
                                onSubmit={(data) => {
                                  if (editingUnit) {
                                    updateUnit(myZimmer.id, editingUnit.id, data);
                                  } else {
                                    addUnit(myZimmer.id, data);
                                  }
                                }}
                                onCancel={() => { setShowUnitForm(false); setEditingUnit(null); }}
                              />
                            </div>
                          )}

                          {/* Units List */}
                          {(!myZimmer.units || myZimmer.units.length === 0) ? (
                            <div className="text-center py-6 text-face-muted">
                              <Home className="mx-auto mb-2 opacity-30" size={40} />
                              <p className="text-sm">אין יחידות נופש. הוסף יחידה כדי לנהל זמינות לכל יחידה בנפרד.</p>
                              <p className="text-xs mt-1">או השתמש בלוח התפוסה הכללי למטה.</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {myZimmer.units.map(unit => (
                                <div key={unit.id} className="border border-face-border rounded-lg overflow-hidden">
                                  {/* Unit Header */}
                                  <div
                                    className="flex items-center justify-between p-3 bg-neutral-50 cursor-pointer hover:bg-neutral-100 transition-all"
                                    onClick={() => setExpandedUnitCalendar(expandedUnitCalendar === unit.id ? null : unit.id)}
                                  >
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 bg-whatsapp-primary/10 rounded-lg flex items-center justify-center">
                                        <Home size={20} className="text-whatsapp-primary" />
                                      </div>
                                      <div>
                                        <h4 className="font-bold text-face-text">{unit.name}</h4>
                                        <div className="text-xs text-face-muted flex items-center gap-2">
                                          <span>{unit.rooms} חדרים</span>
                                          <span>•</span>
                                          <span>{unit.beds} מיטות</span>
                                          {unit.price && (
                                            <>
                                              <span>•</span>
                                              <span>{unit.price}</span>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setEditingUnit(unit); setShowUnitForm(true); }}
                                        className="p-1.5 text-face-muted hover:text-blue-500 hover:bg-blue-50 rounded transition-all"
                                        title="ערוך יחידה"
                                      >
                                        <Edit2 size={16} />
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); deleteUnit(myZimmer.id, unit.id); }}
                                        className="p-1.5 text-face-muted hover:text-red-500 hover:bg-red-50 rounded transition-all"
                                        title="מחק יחידה"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                      {expandedUnitCalendar === unit.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                    </div>
                                  </div>

                                  {/* Unit Calendar */}
                                  {expandedUnitCalendar === unit.id && (
                                    <div className="p-3 border-t border-face-border">
                                      <UnitCalendar
                                        unit={unit}
                                        month={myZimmerCalendarMonth}
                                        onMonthChange={setMyZimmerCalendarMonth}
                                        onUpdateStatus={(date, status) => updateUnitDateStatus(myZimmer.id, unit.id, date, status)}
                                      />
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Zimmer-level Calendar (when no units) */}
                        {(!myZimmer.units || myZimmer.units.length === 0) && (
                          <div className="bg-white rounded-lg border border-face-border p-4">
                            <h3 className="font-bold text-face-text flex items-center gap-2 mb-4">
                              <CalendarIcon size={18} />
                              לוח תפוסה
                            </h3>
                            <ZimmerAvailabilityCalendar
                              zimmer={myZimmer}
                              month={myZimmerCalendarMonth}
                              onMonthChange={setMyZimmerCalendarMonth}
                              onUpdateStatus={async (date, status) => {
                                const newStatuses = { ...(myZimmer.dateStatuses || {}), [date]: status };
                                if (status === 'available') delete newStatuses[date];
                                await updateZimmer(myZimmer.id, { dateStatuses: newStatuses });
                              }}
                            />
                          </div>
                        )}

                        {/* Matching Requests Section */}
                        <div className="bg-white rounded-lg border border-face-border p-4">
                          <h3 className="font-bold text-face-text flex items-center gap-2 mb-4">
                            <Heart size={18} className="text-pink-500" />
                            ביקושים מתאימים
                          </h3>
                          {myMatches.length === 0 ? (
                            <div className="text-center py-6 text-face-muted">
                              <Heart className="mx-auto mb-2 opacity-30" size={40} />
                              <p className="text-sm">אין כרגע ביקושים שמתאימים לצימר שלך</p>
                              <p className="text-xs mt-1">ביקושים חדשים יופיעו כאן כשיתאימו למיקום ולפרטים שלך</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="text-xs text-face-muted mb-2">
                                נמצאו {myMatches.length} ביקושים מתאימים
                              </div>
                              {myMatches.map(({ request, score, matchDetails }) => (
                                <div key={request.id} className="p-3 rounded-lg border border-pink-200 bg-pink-50/50">
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-2">
                                        <span className="font-bold text-face-text">{request.customerName}</span>
                                        <span className="px-2 py-0.5 bg-pink-100 text-pink-700 rounded-full text-xs font-bold">
                                          {score}% התאמה
                                        </span>
                                      </div>
                                      <div className="flex flex-wrap gap-3 text-sm text-face-muted">
                                        <span className="flex items-center gap-1">
                                          <CalendarIcon size={14} />
                                          {request.dates}
                                        </span>
                                        {request.locationPref && (
                                          <span className="flex items-center gap-1">
                                            <MapPin size={14} />
                                            {request.locationPref}
                                          </span>
                                        )}
                                        <span className="flex items-center gap-1">
                                          <DoorOpen size={14} />
                                          {request.roomsNeeded} חדרים
                                        </span>
                                        <span className="flex items-center gap-1">
                                          <Bed size={14} />
                                          {request.bedsNeeded} מיטות
                                        </span>
                                      </div>
                                      {request.contactInfo && (
                                        <div className="mt-2">
                                          <a
                                            href={`https://wa.me/972${request.contactInfo.replace(/^0/, '').replace(/[-\s]/g, '')}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 px-3 py-1 bg-whatsapp-primary text-white text-xs rounded-lg font-bold hover:bg-whatsapp-dark transition-all"
                                          >
                                            <MessageCircle size={14} />
                                            WhatsApp
                                          </a>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </motion.div>
              )}
              {activeTab === 'stats' && (
                <motion.div
                  key="stats"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="max-w-6xl mx-auto"
                >
                  <StatsView zimmers={zimmers} requests={requests} />
                </motion.div>
              )}
              {activeTab === 'admin' && isAdmin && (
                <motion.div
                  key="admin"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="max-w-4xl mx-auto"
                >
                  <AdminView zimmers={zimmers} requests={requests} onUpdateZimmer={updateZimmer} onDeleteZimmer={deleteZimmer} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="bg-white border-t border-face-border py-6 px-4 text-center pb-12">
        <div className="flex flex-col items-center gap-3">
          <a href="https://achvata.com" target="_blank" rel="noopener noreferrer">
            <img src="/achvata-logo.png" alt="אחוותא" className="h-12 object-contain hover:opacity-80 transition-opacity cursor-pointer" />
          </a>
          <p className="text-sm font-bold text-[#e67e22]">
            בחסות אחוותא - יש מקום לכולם
          </p>
          <div className="text-xs text-gray-400 mt-2">
            <a href="/privacy.html" className="hover:text-gray-600">Privacy Policy</a>
            <span className="mx-2">|</span>
            <a href="/terms.html" className="hover:text-gray-600">Terms of Service</a>
          </div>
        </div>
      </footer>

      {/* Import Modal - styled to match theme */}
      <AnimatePresence>
        {isImportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => !isImporting && setIsImportModalOpen(false)}
              className="absolute inset-0 bg-[#3b5998]/20 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-white w-full max-w-xl rounded-lg shadow-2xl overflow-hidden border border-face-border"
            >
              <div className="px-6 py-4 border-b border-face-border flex items-center justify-between bg-[#DCF8C6]/30">
                <h3 className="text-lg font-bold text-whatsapp-dark flex items-center gap-2">
                  <Download size={20} />
                  סנכרון נתונים מוואטסאפ
                </h3>
                <button 
                  onClick={() => setIsImportModalOpen(false)}
                  disabled={isImporting}
                  className="text-face-muted hover:text-face-text"
                >
                  <X size={24} />
                </button>
              </div>
              <div className="p-6">
                <div className="mb-4 bg-[#DCF8C6] p-4 rounded-lg border-r-4 border-whatsapp-dark text-xs leading-relaxed text-whatsapp-dark italic">
                  <b>הדבק את הודעות הקבוצה כאן:</b> המערכת תזהה באופן אוטומטי אם מדובר בצימר פנוי או בלקוח שמחפש מקום ותקטלג אותם בהתאם.
                </div>
                <textarea 
                  className="w-full h-48 p-4 bg-neutral-50 border border-face-border rounded focus:outline-none focus:ring-1 focus:ring-whatsapp-primary text-sm font-mono"
                  placeholder="הדבק כאן את הטקסט..."
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  disabled={isImporting}
                />
              </div>
              <div className="px-6 py-4 bg-[#F9FAFB] border-t border-face-border flex justify-end gap-3">
                <button 
                  onClick={() => setIsImportModalOpen(false)}
                  disabled={isImporting}
                  className="px-4 py-2 text-sm font-bold text-face-muted hover:text-face-text"
                >
                  סגור
                </button>
                <button 
                  onClick={handleImport}
                  disabled={isImporting || !importText.trim()}
                  className="px-6 py-2 bg-whatsapp-primary hover:bg-whatsapp-dark text-white rounded font-bold shadow-sm disabled:opacity-50 transition-all flex items-center gap-2 text-sm"
                >
                  {isImporting ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      מנתח...
                    </>
                  ) : (
                    'הוסף למאגר'
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Unit Form Component
interface UnitFormProps {
  initialData?: Partial<ZimmerUnit>;
  onSubmit: (data: Omit<ZimmerUnit, 'id'>) => void;
  onCancel: () => void;
}

function UnitForm({ initialData, onSubmit, onCancel }: UnitFormProps) {
  const [name, setName] = useState(initialData?.name || '');
  const [rooms, setRooms] = useState(initialData?.rooms || 1);
  const [beds, setBeds] = useState(initialData?.beds || 2);
  const [price, setPrice] = useState(initialData?.price || '');
  const [notes, setNotes] = useState(initialData?.notes || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('יש להזין שם ליחידה');
      return;
    }
    onSubmit({ name, rooms, beds, price: price || undefined, notes: notes || undefined });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs font-bold text-face-muted block mb-1">שם היחידה *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="לדוגמה: סוויטה רומנטית"
          className="w-full px-3 py-2 border border-face-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp-primary"
          maxLength={50}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-face-muted block mb-1">חדרים</label>
          <input
            type="number"
            value={rooms}
            onChange={(e) => setRooms(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
            min={1}
            max={20}
            className="w-full px-3 py-2 border border-face-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp-primary"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-face-muted block mb-1">מיטות</label>
          <input
            type="number"
            value={beds}
            onChange={(e) => setBeds(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
            min={1}
            max={50}
            className="w-full px-3 py-2 border border-face-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp-primary"
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-bold text-face-muted block mb-1">מחיר (אופציונלי)</label>
        <input
          type="text"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="לדוגמה: 800 ללילה"
          className="w-full px-3 py-2 border border-face-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp-primary"
          maxLength={50}
        />
      </div>
      <div>
        <label className="text-xs font-bold text-face-muted block mb-1">הערות (אופציונלי)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="פרטים נוספים על היחידה..."
          className="w-full px-3 py-2 border border-face-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp-primary resize-none"
          rows={2}
          maxLength={500}
        />
        <div className="text-xs text-face-muted text-left mt-1">{notes.length}/500</div>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 bg-neutral-100 text-face-text rounded-lg text-sm font-bold hover:bg-neutral-200 transition-all"
        >
          ביטול
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-whatsapp-primary text-white rounded-lg text-sm font-bold hover:bg-whatsapp-dark transition-all"
        >
          {initialData ? 'עדכן' : 'הוסף'}
        </button>
      </div>
    </form>
  );
}

// Unit Calendar Component (for editing unit availability)
interface UnitCalendarProps {
  unit: ZimmerUnit;
  month: Date;
  onMonthChange: (date: Date) => void;
  onUpdateStatus: (date: string, status: DateStatus) => void;
}

function UnitCalendar({ unit, month, onMonthChange, onUpdateStatus }: UnitCalendarProps) {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const firstDayOfWeek = monthStart.getDay();
  const hebrewDays = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

  const statusColors: Record<DateStatus, string> = {
    available: 'bg-green-100 text-green-700 border-green-300',
    maybe: 'bg-amber-100 text-amber-700 border-amber-300',
    occupied: 'bg-red-100 text-red-700 border-red-300'
  };

  const getStatus = (dateKey: string): DateStatus => {
    if (unit.dateStatuses && unit.dateStatuses[dateKey]) {
      return unit.dateStatuses[dateKey];
    }
    return 'available';
  };

  const cycleStatus = (current: DateStatus): DateStatus => {
    if (current === 'available') return 'occupied';
    if (current === 'occupied') return 'maybe';
    return 'available';
  };

  return (
    <div className="space-y-2">
      {/* Status Legend */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-green-100 border border-green-300" />
            <span>פנוי</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-amber-100 border border-amber-300" />
            <span>אולי</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-red-100 border border-red-300" />
            <span>תפוס</span>
          </div>
        </div>
        <div className="text-xs text-face-muted">לחץ על תאריך לשנות סטטוס</div>
      </div>

      {/* Month Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => onMonthChange(addDays(monthStart, -15))}
          className="p-1 hover:bg-neutral-100 rounded transition-all"
        >
          <ChevronUp size={16} className="rotate-90" />
        </button>
        <span className="text-sm font-bold">{format(month, 'MMMM yyyy', { locale: he })}</span>
        <button
          onClick={() => onMonthChange(addDays(monthEnd, 15))}
          className="p-1 hover:bg-neutral-100 rounded transition-all"
        >
          <ChevronDown size={16} className="rotate-90" />
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {hebrewDays.map((day, i) => (
          <div key={day} className={`text-center text-xs font-bold py-1 ${i === 6 ? 'text-blue-600' : 'text-face-muted'}`}>
            {day}
          </div>
        ))}
        {Array.from({ length: firstDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {days.map(day => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const isToday = isSameDay(day, new Date());
          const isPast = day < new Date(new Date().setHours(0, 0, 0, 0));
          const status = getStatus(dateKey);

          return (
            <button
              key={dateKey}
              disabled={isPast}
              onClick={() => onUpdateStatus(dateKey, cycleStatus(status))}
              className={`p-2 text-xs rounded border transition-all ${
                isPast ? 'opacity-40 cursor-not-allowed bg-neutral-50' : statusColors[status] + ' hover:opacity-80 cursor-pointer'
              } ${isToday ? 'ring-2 ring-amber-400' : ''}`}
            >
              {format(day, 'd')}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Zimmer Availability Calendar Component (for zimmers without units)
interface ZimmerAvailabilityCalendarProps {
  zimmer: ZimmerAvailability;
  month: Date;
  onMonthChange: (date: Date) => void;
  onUpdateStatus: (date: string, status: DateStatus) => void;
}

function ZimmerAvailabilityCalendar({ zimmer, month, onMonthChange, onUpdateStatus }: ZimmerAvailabilityCalendarProps) {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const firstDayOfWeek = monthStart.getDay();
  const hebrewDays = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

  const statusColors: Record<DateStatus, string> = {
    available: 'bg-green-100 text-green-700 border-green-300',
    maybe: 'bg-amber-100 text-amber-700 border-amber-300',
    occupied: 'bg-red-100 text-red-700 border-red-300'
  };

  const getStatus = (dateKey: string): DateStatus => {
    if (zimmer.dateStatuses && zimmer.dateStatuses[dateKey]) {
      return zimmer.dateStatuses[dateKey];
    }
    if (zimmer.disabledDates?.includes(dateKey)) {
      return 'occupied';
    }
    return 'available';
  };

  const cycleStatus = (current: DateStatus): DateStatus => {
    if (current === 'available') return 'occupied';
    if (current === 'occupied') return 'maybe';
    return 'available';
  };

  return (
    <div className="space-y-2">
      {/* Status Legend */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-green-100 border border-green-300" />
            <span>פנוי</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-amber-100 border border-amber-300" />
            <span>אולי</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-red-100 border border-red-300" />
            <span>תפוס</span>
          </div>
        </div>
        <div className="text-xs text-face-muted">לחץ על תאריך לשנות סטטוס</div>
      </div>

      {/* Month Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => onMonthChange(addDays(monthStart, -15))}
          className="p-1 hover:bg-neutral-100 rounded transition-all"
        >
          <ChevronUp size={16} className="rotate-90" />
        </button>
        <span className="text-sm font-bold">{format(month, 'MMMM yyyy', { locale: he })}</span>
        <button
          onClick={() => onMonthChange(addDays(monthEnd, 15))}
          className="p-1 hover:bg-neutral-100 rounded transition-all"
        >
          <ChevronDown size={16} className="rotate-90" />
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {hebrewDays.map((day, i) => (
          <div key={day} className={`text-center text-xs font-bold py-1 ${i === 6 ? 'text-blue-600' : 'text-face-muted'}`}>
            {day}
          </div>
        ))}
        {Array.from({ length: firstDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {days.map(day => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const isToday = isSameDay(day, new Date());
          const isPast = day < new Date(new Date().setHours(0, 0, 0, 0));
          const status = getStatus(dateKey);

          return (
            <button
              key={dateKey}
              disabled={isPast}
              onClick={() => onUpdateStatus(dateKey, cycleStatus(status))}
              className={`p-2 text-xs rounded border transition-all ${
                isPast ? 'opacity-40 cursor-not-allowed bg-neutral-50' : statusColors[status] + ' hover:opacity-80 cursor-pointer'
              } ${isToday ? 'ring-2 ring-amber-400' : ''}`}
            >
              {format(day, 'd')}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Main Calendar Component for browsing available zimmers
interface MainCalendarProps {
  zimmers: ZimmerAvailability[];
  month: Date;
  onMonthChange: (date: Date) => void;
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  getZimmerStatusForDate: (zimmer: ZimmerAvailability, dateKey: string) => DateStatus;
  getAvailableUnitsForDate: (zimmer: ZimmerAvailability, dateKey: string) => { unit: ZimmerUnit; status: DateStatus }[];
}

function MainCalendar({
  zimmers,
  month,
  onMonthChange,
  selectedDate,
  onSelectDate,
  getZimmerStatusForDate,
  getAvailableUnitsForDate
}: MainCalendarProps) {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const firstDayOfWeek = monthStart.getDay();
  const hebrewDays = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

  // Get Hebrew date for display
  const getHebrewDate = (date: Date): string => {
    try {
      const hd = new HDate(date);
      return hd.renderGematriya();
    } catch {
      return '';
    }
  };

  // Get available zimmers for selected date
  const availableZimmersForDate = useMemo(() => {
    if (!selectedDate) return [];
    return zimmers
      .map(zimmer => {
        const status = getZimmerStatusForDate(zimmer, selectedDate);
        const availableUnits = getAvailableUnitsForDate(zimmer, selectedDate);
        return { zimmer, status, availableUnits };
      })
      .filter(({ status }) => status !== 'occupied');
  }, [zimmers, selectedDate, getZimmerStatusForDate, getAvailableUnitsForDate]);

  return (
    <div className="space-y-4">
      {/* Calendar */}
      <div className="bg-white rounded-lg border border-face-border overflow-hidden">
        {/* Month Navigation */}
        <div className="flex items-center justify-between p-3 border-b border-face-border bg-gradient-to-l from-whatsapp-primary/10 to-white">
          <button
            onClick={() => onMonthChange(addDays(monthStart, -15))}
            className="p-2 hover:bg-neutral-100 rounded-lg transition-all"
          >
            <ChevronUp size={20} className="rotate-90" />
          </button>
          <div className="text-center">
            <h2 className="text-lg font-bold text-face-text">
              {format(month, 'MMMM yyyy', { locale: he })}
            </h2>
            <p className="text-xs text-face-muted">לחץ על תאריך לראות צימרים פנויים</p>
          </div>
          <button
            onClick={() => onMonthChange(addDays(monthEnd, 15))}
            className="p-2 hover:bg-neutral-100 rounded-lg transition-all"
          >
            <ChevronDown size={20} className="rotate-90" />
          </button>
        </div>

        {/* Day Headers */}
        <div className="grid grid-cols-7 border-b border-face-border">
          {hebrewDays.map((day, i) => (
            <div key={day} className={`p-2 text-center text-xs font-bold bg-neutral-50 ${i === 6 ? 'text-blue-600' : 'text-face-muted'}`}>
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7">
          {/* Empty cells */}
          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="min-h-[60px] p-1 bg-neutral-50/50 border-b border-l border-face-border" />
          ))}

          {/* Days */}
          {days.map(day => {
            const dateKey = format(day, 'yyyy-MM-dd');
            const isToday = isSameDay(day, new Date());
            const isShabbat = day.getDay() === 6;
            const hebrewDate = getHebrewDate(day);
            const isSelected = selectedDate === dateKey;
            const isPast = day < new Date(new Date().setHours(0, 0, 0, 0));

            // Count available zimmers for this day
            const availableCount = zimmers.filter(z => getZimmerStatusForDate(z, dateKey) !== 'occupied').length;

            return (
              <div
                key={dateKey}
                onClick={() => !isPast && onSelectDate(isSelected ? null : dateKey)}
                className={`min-h-[60px] p-1 border-b border-l border-face-border transition-all ${
                  isPast ? 'bg-neutral-100 opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-whatsapp-primary/5'
                } ${isToday ? 'bg-amber-50' : isShabbat ? 'bg-blue-50/30' : ''
                } ${isSelected ? 'ring-2 ring-whatsapp-primary ring-inset bg-whatsapp-primary/10' : ''}`}
              >
                {/* Date Header */}
                <div className="flex justify-between items-start mb-1">
                  <span className={`text-sm font-bold ${isToday ? 'text-amber-600' : isShabbat ? 'text-blue-600' : 'text-face-text'}`}>
                    {format(day, 'd')}
                  </span>
                  <span className="text-[9px] text-face-muted">{hebrewDate}</span>
                </div>

                {/* Available Count */}
                {!isPast && availableCount > 0 && (
                  <div className="text-center mt-1">
                    <span className="text-[10px] text-whatsapp-primary font-bold">
                      {availableCount} פנויים
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Available Zimmers List */}
      {selectedDate && (
        <div className="bg-white rounded-lg border border-face-border p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-face-text flex items-center gap-2">
              <CalendarIcon size={20} className="text-whatsapp-primary" />
              צימרים פנויים ב-{format(parseISO(selectedDate), 'd בMMMM yyyy', { locale: he })}
            </h3>
            <button
              onClick={() => onSelectDate(null)}
              className="p-2 text-face-muted hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
              title="סגור"
            >
              <X size={18} />
            </button>
          </div>

          {/* Status Legend */}
          <div className="flex items-center gap-4 text-xs text-face-muted mb-4 pb-3 border-b border-face-border">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span>פנוי</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-amber-500" />
              <span>אולי פנוי</span>
            </div>
          </div>

          {availableZimmersForDate.length === 0 ? (
            <div className="text-center py-8 text-face-muted">
              <div className="text-4xl mb-2">😔</div>
              <p>אין צימרים פנויים בתאריך זה</p>
            </div>
          ) : (
            <div className="space-y-4">
              {availableZimmersForDate.map(({ zimmer, status, availableUnits }) => (
                <div
                  key={zimmer.id}
                  className={`p-4 rounded-lg border ${
                    status === 'available' ? 'border-green-200 bg-green-50/50' : 'border-amber-200 bg-amber-50/50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Logo */}
                    {zimmer.logo && (
                      <img
                        src={zimmer.logo}
                        alt={zimmer.name}
                        className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                      />
                    )}

                    <div className="flex-1 min-w-0">
                      {/* Zimmer Name & Status */}
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-bold text-face-text">{zimmer.name}</h4>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                          status === 'available'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {status === 'available' ? 'פנוי' : 'אולי פנוי'}
                        </span>
                      </div>

                      {/* Location & Details */}
                      <div className="flex flex-wrap items-center gap-3 text-sm text-face-muted mb-2">
                        <span className="flex items-center gap-1">
                          <MapPin size={14} />
                          {zimmer.location}
                        </span>
                        {!zimmer.units?.length && (
                          <>
                            <span className="flex items-center gap-1">
                              <DoorOpen size={14} />
                              {zimmer.rooms} חדרים
                            </span>
                            <span className="flex items-center gap-1">
                              <Bed size={14} />
                              {zimmer.beds} מיטות
                            </span>
                          </>
                        )}
                        {zimmer.price && (
                          <span className="flex items-center gap-1">
                            <DollarSign size={14} />
                            {zimmer.price}
                          </span>
                        )}
                      </div>

                      {/* Units List */}
                      {availableUnits.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <p className="text-xs font-bold text-face-muted">יחידות נופש פנויות:</p>
                          {availableUnits.map(({ unit, status: unitStatus }) => (
                            <div
                              key={unit.id}
                              className={`flex items-center gap-2 p-2 rounded ${
                                unitStatus === 'available' ? 'bg-green-100/50' : 'bg-amber-100/50'
                              }`}
                            >
                              <div className={`w-2 h-2 rounded-full ${
                                unitStatus === 'available' ? 'bg-green-500' : 'bg-amber-500'
                              }`} />
                              <span className="font-medium text-sm">{unit.name}</span>
                              <span className="text-xs text-face-muted">
                                {unit.rooms} חדרים | {unit.beds} מיטות
                              </span>
                              {unit.price && (
                                <span className="text-xs text-face-muted">| {unit.price}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Contact */}
                      {zimmer.contactInfo && (
                        <div className="mt-3 pt-2 border-t border-face-border/50">
                          <a
                            href={`https://wa.me/972${zimmer.contactInfo.replace(/^0/, '').replace(/[-\s]/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-3 py-1.5 bg-whatsapp-primary text-white text-sm font-bold rounded-lg hover:bg-whatsapp-dark transition-all"
                          >
                            <MessageCircle size={14} />
                            WhatsApp
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ZimmerCardProps {
  zimmer: ZimmerAvailability;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<ZimmerAvailability>) => void;
  isEditing: boolean;
  setIsEditing: (val: boolean) => void;
  isAdmin?: boolean;
}

function ZimmerCard({ zimmer, onDelete, onUpdate, isEditing, setIsEditing, isAdmin: isAdminProp }: ZimmerCardProps) {
  const [localData, setLocalData] = useState(zimmer);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showLightbox, setShowLightbox] = useState(false);
  const currentUser = auth.currentUser;
  const isOwner = currentUser?.uid === zimmer.ownerUid;

  // Images only (not logo) for carousel
  const images = zimmer.images || [];

  // All images including logo for lightbox
  const allImages = useMemo(() => {
    const imgs: string[] = [];
    if (zimmer.logo) imgs.push(zimmer.logo);
    if (zimmer.images?.length) imgs.push(...zimmer.images);
    return imgs;
  }, [zimmer.logo, zimmer.images]);

  // Auto carousel every 3 seconds
  useEffect(() => {
    if (images.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentImageIndex((prev) => (prev + 1) % images.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [images.length]);

  // Debug logo
  console.log('[ZimmerCard]', zimmer.name, 'logo:', zimmer.logo ? 'YES' : 'NO', 'images:', zimmer.images?.length || 0);

  useEffect(() => {
    setLocalData(zimmer);
  }, [zimmer]);

  const handleSave = () => {
    onUpdate(zimmer.id, localData);
    setIsEditing(false);
  };

  const handleDateSelect = (dates: Date[] | undefined) => {
    if (!isOwner) return;
    const isoDates = (dates || []).map(d => d.toISOString().split('T')[0]);
    onUpdate(zimmer.id, { disabledDates: isoDates });
  };

  const selectedDates = (zimmer.disabledDates || []).map(d => parseISO(d)).filter(d => isValid(d));

  return (
    <div className="whatsapp-card relative">
      {isEditing ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-face-muted uppercase">שם הצימר</label>
              <input 
                className="w-full p-2 border border-face-border rounded text-sm" 
                value={localData.name} 
                onChange={e => setLocalData({...localData, name: e.target.value})} 
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-face-muted uppercase">מיקום</label>
              <input 
                className="w-full p-2 border border-face-border rounded text-sm" 
                value={localData.location} 
                onChange={e => setLocalData({...localData, location: e.target.value})} 
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-face-muted uppercase">תאריכים</label>
              <input 
                className="w-full p-2 border border-face-border rounded text-sm" 
                value={localData.dates} 
                onChange={e => setLocalData({...localData, dates: e.target.value})} 
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-face-muted uppercase">חדרים</label>
                <input 
                  type="number"
                  className="w-full p-2 border border-face-border rounded text-sm" 
                  value={localData.rooms} 
                  onChange={e => setLocalData({...localData, rooms: parseInt(e.target.value)})} 
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-face-muted uppercase">מיטות</label>
                <input 
                  type="number"
                  className="w-full p-2 border border-face-border rounded text-sm" 
                  value={localData.beds} 
                  onChange={e => setLocalData({...localData, beds: parseInt(e.target.value)})} 
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setIsEditing(false)} className="text-xs font-bold text-face-muted px-2 py-1">ביטול</button>
            <button onClick={handleSave} className="bg-whatsapp-dark text-white px-3 py-1 rounded font-bold text-xs flex items-center gap-1">
              <Check size={14} /> שמור
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Images Gallery - Logo small, main image large, thumbnails below */}
          {(zimmer.logo || images.length > 0) && (
            <div className="mb-4">
              <div className="flex gap-3">
                {/* Logo - small */}
                {zimmer.logo && (
                  <div className="flex-shrink-0">
                    <img
                      src={zimmer.logo}
                      alt={`${zimmer.name} לוגו`}
                      className="w-12 h-12 md:w-14 md:h-14 rounded-lg object-cover border-2 border-face-border shadow-sm cursor-pointer hover:opacity-90"
                      onClick={() => setShowLightbox(true)}
                    />
                  </div>
                )}

                {/* Main image - large with carousel */}
                {images.length > 0 && (
                  <div className="flex-1 relative">
                    <img
                      src={images[currentImageIndex]}
                      alt={zimmer.name}
                      className="w-full h-32 md:h-40 rounded-xl object-cover border-2 border-face-border shadow-md cursor-pointer hover:opacity-95 transition-all"
                      onClick={() => setShowLightbox(true)}
                    />
                    {/* Carousel indicators */}
                    {images.length > 1 && (
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                        {images.map((_, idx) => (
                          <button
                            key={idx}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentImageIndex(idx);
                            }}
                            className={`w-2 h-2 rounded-full transition-all ${
                              idx === currentImageIndex ? 'bg-white scale-110' : 'bg-white/50 hover:bg-white/70'
                            }`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Thumbnail images - small below */}
              {images.length > 1 && (
                <div className="flex gap-2 mt-2 mr-14 md:mr-16">
                  {images.map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentImageIndex(idx)}
                      className={`flex-shrink-0 transition-all ${
                        idx === currentImageIndex ? 'ring-2 ring-whatsapp-primary scale-105' : 'opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img
                        src={img}
                        alt={`תמונה ${idx + 1}`}
                        className="w-14 h-14 md:w-16 md:h-16 rounded-lg object-cover border border-face-border"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-4">
            <div className="flex-1 flex justify-between items-start">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="whatsapp-tag whatsapp-tag-green">פנוי</span>
                  <h3 className="font-bold text-face-text text-base">{zimmer.name}</h3>
                  {isOwner && <span className="text-[10px] bg-whatsapp-dark/10 text-whatsapp-dark px-2 rounded-full font-bold">הצימר שלי</span>}
                </div>
                <div className="flex items-center gap-3 text-xs text-face-muted flex-wrap">
                  <span className="flex items-center gap-1"><MapPin size={12} /> {zimmer.location}</span>
                  <span className="text-face-border opacity-50 hidden sm:inline">|</span>
                  <span className="flex items-center gap-1"><CalendarIcon size={12} /> {zimmer.dates}</span>
                </div>
              </div>
            <div className="flex gap-2">
              <button
                onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                className={`p-1.5 border border-face-border rounded transition-all ${isCalendarOpen ? 'bg-whatsapp-dark text-white' : 'text-face-muted hover:bg-neutral-50'}`}
                title="יומן תפוסה"
              >
                <CalendarIcon size={14} />
              </button>
              {(isOwner || isAdminProp) && (
                <>
                  <button onClick={() => setIsEditing(true)} className="p-1.5 text-face-muted hover:text-whatsapp-dark border border-face-border rounded hover:bg-neutral-50 transition-all">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => onDelete(zimmer.id)} className="p-1.5 text-face-muted hover:text-red-600 border border-face-border rounded hover:bg-red-50 transition-all">
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
            </div>
          </div>

          <AnimatePresence>
            {isCalendarOpen && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }} 
                animate={{ height: 'auto', opacity: 1 }} 
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-4 p-4 bg-neutral-50 border border-face-border rounded-lg flex flex-col md:flex-row items-center gap-6">
                  <div className="bg-white p-2 rounded border border-face-border shadow-sm">
                    <DayPicker
                      mode="multiple"
                      selected={selectedDates}
                      onSelect={handleDateSelect}
                      locale={he}
                      dir="rtl"
                    />
                  </div>
                  <div className="flex-1 space-y-3">
                    <h4 className="text-xs font-bold text-face-text uppercase tracking-wider">סטטוס יומן תפוסה</h4>
                    <p className="text-[11px] text-face-muted leading-relaxed">
                      {isOwner ? 
                        `בעל הצימר: לחץ על התאריכים בלוח השנה כדי לסמן אותם כתפוסים/זמינים. שאר המשתמשים יראו זאת בזמן אמת.` : 
                        `תאריכים מסומנים באדום/תפוסים בלוח השנה אינם זמינים להזמנה.`
                      }
                    </p>
                    <div className="flex items-center gap-4 text-[10px] font-bold">
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 bg-whatsapp-primary rounded" />
                        <span>פנוי</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                         <div className="w-3 h-3 bg-[#e11d48] rounded" />
                         <span>תפוס</span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-4 flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-1.5 text-xs font-bold bg-neutral-100 px-2 py-1 rounded border border-face-border">
              <DoorOpen size={14} className="text-face-muted" />
              <span>{zimmer.rooms} חדרים</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold bg-neutral-100 px-2 py-1 rounded border border-face-border">
              <Bed size={14} className="text-face-muted" />
              <span>{zimmer.beds} מיטות</span>
            </div>
            {zimmer.price && (
              <span className="text-xs font-extrabold text-[#14A44D] ml-auto">{zimmer.price}</span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-3 items-center">
            {zimmer.contactInfo && (
              <PhoneActions phone={zimmer.contactInfo} name={zimmer.name} />
            )}
            {zimmer.notes && (
              <div className="flex items-center gap-1 text-[11px] text-[#65676B] italic">
                <Info size={12}/> {zimmer.notes}
              </div>
            )}
          </div>
        </>
      )}

      {/* Lightbox Modal for full-size images */}
      <AnimatePresence>
        {showLightbox && allImages.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
            onClick={() => setShowLightbox(false)}
          >
            <button
              onClick={() => setShowLightbox(false)}
              className="absolute top-4 right-4 text-white/80 hover:text-white p-2"
            >
              <X size={32} />
            </button>

            <div className="relative max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
              <img
                src={allImages[currentImageIndex]}
                alt={zimmer.name}
                className="w-full max-h-[80vh] object-contain rounded-lg"
              />

              {/* Navigation for lightbox */}
              {allImages.length > 1 && (
                <>
                  <button
                    onClick={() => setCurrentImageIndex((prev) => (prev === 0 ? allImages.length - 1 : prev - 1))}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/40 text-white rounded-full p-3 transition-colors"
                  >
                    <ChevronUp size={24} className="rotate-[-90deg]" />
                  </button>
                  <button
                    onClick={() => setCurrentImageIndex((prev) => (prev === allImages.length - 1 ? 0 : prev + 1))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/40 text-white rounded-full p-3 transition-colors"
                  >
                    <ChevronDown size={24} className="rotate-[-90deg]" />
                  </button>
                </>
              )}

              {/* Thumbnails */}
              {allImages.length > 1 && (
                <div className="flex justify-center gap-2 mt-4">
                  {allImages.map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentImageIndex(idx)}
                      className={`w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                        idx === currentImageIndex ? 'border-white scale-105' : 'border-transparent opacity-60 hover:opacity-100'
                      }`}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              {/* Image counter */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/50 text-white px-3 py-1 rounded-full text-sm font-medium">
                {currentImageIndex + 1} / {allImages.length}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface RequestCardProps {
  request: CustomerRequest;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<CustomerRequest>) => void;
  isEditing: boolean;
  setIsEditing: (val: boolean) => void;
  zimmers: ZimmerAvailability[];
  onClaim?: (id: string) => void;
  userRole?: string;
  isAdmin?: boolean;
}

function RequestCard({ request, onDelete, onUpdate, isEditing, setIsEditing, zimmers, onClaim, userRole, isAdmin: isAdminProp }: RequestCardProps) {
  const [localData, setLocalData] = useState(request);
  const [showMatches, setShowMatches] = useState(false);
  const [matchFilterDate, setMatchFilterDate] = useState<string>('');
  const currentUser = auth.currentUser;
  const isCreator = currentUser?.uid === request.createdBy;
  const isClaimed = !!request.claimedBy;
  const isClaimedByMe = request.claimedBy?.uid === currentUser?.uid;
  const isExpired = isDateRangePast(request.dates);

  // Calculate matches and filter by date if selected
  const allMatches = findMatchingZimmers(request, zimmers);
  const matches = matchFilterDate
    ? allMatches.filter(match => {
        const statuses = match.zimmer.dateStatuses || {};
        const status = statuses[matchFilterDate];
        // Show only available or unknown (no status = available)
        return !status || status === 'available';
      })
    : allMatches;

  useEffect(() => {
    setLocalData(request);
  }, [request]);

  const handleSave = () => {
    onUpdate(request.id, localData);
    setIsEditing(false);
  };

  return (
    <div className={`whatsapp-card relative ${isExpired ? 'bg-neutral-100 border-neutral-300 opacity-60' : isClaimed ? 'bg-pink-50 border-pink-200' : ''}`}>
      <div className={`absolute top-0 right-0 w-1.5 h-full ${isExpired ? 'bg-neutral-400' : isClaimed ? 'bg-red-500' : 'bg-[#1877F2]'} rounded-r-lg ${isClaimed || isExpired ? '' : 'opacity-20'}`} />

      {/* Expired Badge */}
      {isExpired && (
        <div className="absolute top-2 left-2 flex items-center gap-2 bg-neutral-200 text-neutral-600 px-3 py-1.5 rounded-full text-xs font-bold">
          <CalendarIcon size={12} />
          <span>עבר התאריך</span>
        </div>
      )}

      {/* Claimed Badge */}
      {isClaimed && !isExpired && (
        <div className="absolute top-2 left-2 flex items-center gap-2 bg-red-100 text-red-600 px-3 py-1.5 rounded-full text-xs font-bold">
          <span>נתפס</span>
          {request.claimedBy?.logo ? (
            <img src={request.claimedBy.logo} alt="" className="w-5 h-5 rounded-full object-cover" />
          ) : (
            <div className="w-5 h-5 rounded-full bg-red-200 flex items-center justify-center text-[10px]">
              {request.claimedBy?.name?.charAt(0)}
            </div>
          )}
          <span className="text-[10px] font-normal">{request.claimedBy?.name}</span>
        </div>
      )}

      {isEditing ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-face-muted uppercase">שם לקוח</label>
              <input 
                className="w-full p-2 border border-face-border rounded text-sm" 
                value={localData.customerName} 
                onChange={e => setLocalData({...localData, customerName: e.target.value})} 
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-face-muted uppercase">מיקום מבוקש</label>
              <input 
                className="w-full p-2 border border-face-border rounded text-sm" 
                value={localData.locationPref || ''} 
                onChange={e => setLocalData({...localData, locationPref: e.target.value})} 
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-face-muted uppercase">תאריכים</label>
              <input 
                className="w-full p-2 border border-face-border rounded text-sm" 
                value={localData.dates} 
                onChange={e => setLocalData({...localData, dates: e.target.value})} 
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-face-muted uppercase">חדרים</label>
                <input
                  type="number"
                  className="w-full p-2 border border-face-border rounded text-sm"
                  value={localData.roomsNeeded}
                  onChange={e => setLocalData({...localData, roomsNeeded: parseInt(e.target.value)})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-face-muted uppercase">מיטות</label>
                <input
                  type="number"
                  className="w-full p-2 border border-face-border rounded text-sm"
                  value={localData.bedsNeeded}
                  onChange={e => setLocalData({...localData, bedsNeeded: parseInt(e.target.value)})}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-face-muted uppercase">טלפון</label>
              <input
                type="tel"
                className="w-full p-2 border border-face-border rounded text-sm"
                value={localData.contactInfo || ''}
                onChange={e => setLocalData({...localData, contactInfo: e.target.value})}
                placeholder="050-1234567"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-face-muted uppercase">תקציב</label>
              <input
                className="w-full p-2 border border-face-border rounded text-sm"
                value={localData.budget || ''}
                onChange={e => setLocalData({...localData, budget: e.target.value})}
                placeholder="2000 ש״ח"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-[10px] font-bold text-face-muted uppercase">הערות</label>
              <input
                className="w-full p-2 border border-face-border rounded text-sm"
                value={localData.notes || ''}
                onChange={e => setLocalData({...localData, notes: e.target.value})}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setIsEditing(false)} className="text-xs font-bold text-face-muted px-2 py-1">ביטול</button>
            <button onClick={handleSave} className="bg-[#1877F2] text-white px-3 py-1 rounded font-bold text-xs flex items-center gap-1">
              <Check size={14} /> שמור
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="whatsapp-tag whatsapp-tag-blue">ביקוש</span>
                <h3 className="font-bold text-face-text text-base">{request.customerName}</h3>
                {isCreator && <span className="text-[10px] bg-[#1877F2]/10 text-[#1877F2] px-2 rounded-full font-bold">הבקשה שלי</span>}
              </div>
              <div className="flex items-center gap-3 text-xs text-face-muted">
                <span className="flex items-center gap-1"><MapPin size={12} /> {request.locationPref || 'כל המקומות'}</span>
              </div>
              {/* Date details */}
              <div className="mt-1 text-xs">
                <div className="flex items-center gap-1 text-face-text font-medium">
                  <CalendarIcon size={12} className="text-[#1877F2]" />
                  <span>{request.dates}</span>
                </div>
                {(() => {
                  const dateInfo = getDetailedDateInfo(request.dates);
                  return dateInfo ? (
                    <div className="text-[11px] text-face-muted mt-0.5 mr-4">
                      {dateInfo.details}
                    </div>
                  ) : null;
                })()}
              </div>
            </div>
            {(isCreator || isAdminProp) && (
              <div className="flex gap-2">
                <button onClick={() => setIsEditing(true)} className="p-1.5 text-face-muted hover:text-[#1877F2] border border-face-border rounded hover:bg-neutral-50 transition-all">
                  <Edit2 size={14} />
                </button>
                <button onClick={() => onDelete(request.id)} className="p-1.5 text-face-muted hover:text-red-600 border border-face-border rounded hover:bg-red-50 transition-all">
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-1.5 text-xs font-bold bg-neutral-100 px-2 py-1 rounded border border-face-border">
              <DoorOpen size={14} className="text-face-muted" />
              <span>{request.roomsNeeded} חדרים דרושים</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold bg-neutral-100 px-2 py-1 rounded border border-face-border">
              <Bed size={14} className="text-face-muted" />
              <span>{request.bedsNeeded} מיטות דרושות</span>
            </div>
            {request.budget && (
              <span className="text-xs font-extrabold text-[#1877F2] ml-auto">תקציב: {request.budget}</span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-3 items-center">
            {request.contactInfo && (
              <PhoneActions phone={request.contactInfo} name={request.customerName} />
            )}
            {request.notes && (
              <div className="flex items-center gap-1 text-[11px] text-[#65676B] italic">
                <Info size={12}/> {request.notes}
              </div>
            )}
          </div>

          {/* Claim Button for zimmer owners */}
          {userRole === 'owner' && onClaim && !isExpired && (
            <div className="mt-4 pt-3 border-t border-face-border">
              <button
                onClick={() => onClaim(request.id)}
                className={`w-full py-2 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                  isClaimedByMe
                    ? 'bg-red-100 text-red-600 hover:bg-red-200'
                    : isClaimed
                    ? 'bg-neutral-100 text-face-muted cursor-not-allowed'
                    : 'bg-whatsapp-primary text-white hover:bg-whatsapp-dark'
                }`}
                disabled={isClaimed && !isClaimedByMe}
              >
                {isClaimedByMe ? (
                  <>
                    <X size={16} />
                    הסר תפיסה
                  </>
                ) : isClaimed ? (
                  'נתפס על ידי אחר'
                ) : (
                  <>
                    <Check size={16} />
                    תפוס ביקוש זה
                  </>
                )}
              </button>
            </div>
          )}

          {/* Matches Section - hide for expired */}
          {!isExpired && (
          <div className="mt-4 border-t border-face-border pt-3">
            <button
              onClick={() => setShowMatches(!showMatches)}
              className={`w-full flex items-center justify-between p-2 rounded-lg transition-all ${
                allMatches.length > 0
                  ? 'bg-gradient-to-l from-emerald-50 to-transparent hover:from-emerald-100 border border-emerald-200'
                  : 'bg-neutral-50 hover:bg-neutral-100 border border-face-border'
              }`}
            >
              <div className="flex items-center gap-2">
                <Sparkles size={16} className={allMatches.length > 0 ? 'text-emerald-600' : 'text-face-muted'} />
                <span className={`text-sm font-bold ${allMatches.length > 0 ? 'text-emerald-700' : 'text-face-muted'}`}>
                  {allMatches.length > 0
                    ? `נמצאו ${allMatches.length} צימרים מתאימים${matchFilterDate ? ` (${matches.length} פנויים)` : ''}`
                    : 'אין התאמות'}
                </span>
              </div>
              {allMatches.length > 0 && (
                showMatches ? <ChevronUp size={16} className="text-emerald-600" /> : <ChevronDown size={16} className="text-emerald-600" />
              )}
            </button>

            <AnimatePresence>
              {showMatches && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  {/* Date filter for matches */}
                  <div className="mt-3 mb-3 flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                    <CalendarIcon size={14} className="text-blue-600" />
                    <span className="text-xs font-bold text-blue-700">סנן לפי תאריך:</span>
                    <input
                      type="date"
                      value={matchFilterDate}
                      onChange={(e) => setMatchFilterDate(e.target.value)}
                      className="flex-1 px-2 py-1 text-sm border border-blue-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    {matchFilterDate && (
                      <button
                        onClick={() => setMatchFilterDate('')}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        נקה
                      </button>
                    )}
                  </div>

                  {matches.length > 0 ? (
                  <div className="space-y-2">
                    {matches.map((match, idx) => (
                      <div
                        key={match.zimmer.id}
                        className="p-3 bg-white border border-face-border rounded-lg shadow-sm"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                match.score >= 80 ? 'bg-emerald-100 text-emerald-700' :
                                match.score >= 60 ? 'bg-yellow-100 text-yellow-700' :
                                'bg-neutral-100 text-neutral-600'
                              }`}>
                                {match.score >= 80 ? 'התאמה מצוינת' : match.score >= 60 ? 'התאמה טובה' : 'התאמה חלקית'}
                              </span>
                              <span className="text-[10px] text-face-muted">{match.score}%</span>
                            </div>
                            <h4 className="font-bold text-sm text-face-text">{match.zimmer.name}</h4>
                            <div className="flex items-center gap-3 text-[11px] text-face-muted mt-1">
                              <span className="flex items-center gap-1">
                                <MapPin size={10} /> {match.zimmer.location}
                              </span>
                              <span className="flex items-center gap-1">
                                <CalendarIcon size={10} /> {match.zimmer.dates}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] mt-2">
                              <span className={`flex items-center gap-1 ${match.matchDetails.roomsMatch ? 'text-emerald-600' : 'text-red-500'}`}>
                                <DoorOpen size={10} /> {match.zimmer.rooms} חדרים
                              </span>
                              <span className={`flex items-center gap-1 ${match.matchDetails.bedsMatch ? 'text-emerald-600' : 'text-red-500'}`}>
                                <Bed size={10} /> {match.zimmer.beds} מיטות
                              </span>
                              {match.zimmer.price && (
                                <span className="text-emerald-600 font-bold">{match.zimmer.price}</span>
                              )}
                            </div>
                          </div>
                          {match.zimmer.contactInfo && (
                            <PhoneActions phone={match.zimmer.contactInfo} name={match.zimmer.name} compact />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  ) : (
                    <div className="text-center text-face-muted text-sm py-4">
                      {matchFilterDate ? 'אין צימרים פנויים בתאריך זה' : 'אין התאמות'}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          )}
        </>
      )}
    </div>
  );
}

// Calendar View Component
interface CalendarViewProps {
  zimmers: ZimmerAvailability[];
  month: Date;
  onMonthChange: (date: Date) => void;
  selectedZimmers: Set<string>;
  onToggleZimmer: (id: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onUpdateDateStatus: (zimmerId: string, date: string, status: DateStatus) => void;
  currentUserId?: string;
  isAdmin?: boolean;
}

// Get Hebrew calendar events for a month (Israel location)
function getHebrewCalendarEvents(year: number, month: number): Map<string, { holiday?: string; parsha?: string; isShabbat: boolean }> {
  const events = new Map<string, { holiday?: string; parsha?: string; isShabbat: boolean }>();

  try {
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0);

    // Israel location for correct holiday observance
    const location = Location.lookup('Jerusalem');

    const options = {
      year: year,
      isHebrewYear: false,
      candlelighting: false,
      sedrot: true,
      il: true, // Israel - holidays are 1 day
      noMinorFast: false,
      noModern: true,
      noRoshChodesh: false,
      shabbatMevarchim: false,
    };

    const cal = HebrewCalendar.calendar(options);

    cal.forEach((ev: Event) => {
      const evDate = ev.getDate().greg();
      if (evDate >= startDate && evDate <= endDate) {
        const key = format(evDate, 'yyyy-MM-dd');
        const existing = events.get(key) || { isShabbat: evDate.getDay() === 6 };

        const desc = ev.render('he');
        const categories = ev.getCategories();

        if (categories.includes('parashat')) {
          existing.parsha = desc.replace('פרשת ', '');
        } else if (categories.includes('holiday') || categories.includes('major')) {
          existing.holiday = desc;
        } else if (categories.includes('roshchodesh')) {
          existing.holiday = desc;
        }

        events.set(key, existing);
      }
    });

    // Mark all Saturdays as Shabbat
    let current = new Date(startDate);
    while (current <= endDate) {
      if (current.getDay() === 6) {
        const key = format(current, 'yyyy-MM-dd');
        const existing = events.get(key) || { isShabbat: true };
        existing.isShabbat = true;
        events.set(key, existing);
      }
      current = addDays(current, 1);
    }
  } catch (e) {
    console.error('Error getting Hebrew calendar:', e);
  }

  return events;
}

function CalendarView({
  zimmers,
  month,
  onMonthChange,
  selectedZimmers,
  onToggleZimmer,
  onSelectAll,
  onClearAll,
  onUpdateDateStatus,
  currentUserId,
  isAdmin: isAdminProp
}: CalendarViewProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const firstDayOfWeek = monthStart.getDay();

  // Get Hebrew calendar events
  const hebrewEvents = getHebrewCalendarEvents(month.getFullYear(), month.getMonth());

  // Get Hebrew date for display
  const getHebrewDate = (date: Date): string => {
    try {
      const hd = new HDate(date);
      return hd.renderGematriya();
    } catch {
      return '';
    }
  };

  const hebrewDays = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

  // Status colors
  const statusColors: Record<DateStatus, string> = {
    available: '#22c55e',
    maybe: '#f59e0b',
    occupied: '#ef4444'
  };

  const statusLabels: Record<DateStatus, string> = {
    available: 'פנוי',
    maybe: 'אולי תפוס',
    occupied: 'תפוס'
  };

  // Get status for a zimmer on a date
  const getDateStatus = (zimmer: ZimmerAvailability, dateKey: string): DateStatus => {
    if (zimmer.dateStatuses && zimmer.dateStatuses[dateKey]) {
      return zimmer.dateStatuses[dateKey];
    }
    // Legacy: check disabledDates
    if (zimmer.disabledDates?.includes(dateKey)) {
      return 'occupied';
    }
    return 'available';
  };

  // Cycle through statuses
  const cycleStatus = (current: DateStatus): DateStatus => {
    if (current === 'available') return 'occupied';
    if (current === 'occupied') return 'maybe';
    return 'available';
  };

  // Filter zimmers to show
  const visibleZimmers = zimmers.filter(z =>
    selectedZimmers.size === 0 || selectedZimmers.has(z.id)
  );

  return (
    <div className="space-y-4">
      {/* Filter Section */}
      <div className="bg-white rounded-lg border border-face-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-face-text flex items-center gap-2">
            <Filter size={16} />
            סינון צימרים
          </h3>
          <div className="flex gap-2">
            <button
              onClick={onSelectAll}
              className="text-xs px-2 py-1 bg-whatsapp-primary text-white rounded hover:bg-whatsapp-dark transition-all"
            >
              בחר הכל
            </button>
            <button
              onClick={onClearAll}
              className="text-xs px-2 py-1 bg-neutral-200 text-face-text rounded hover:bg-neutral-300 transition-all"
            >
              נקה הכל
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {zimmers.map((zimmer, index) => {
            const color = getZimmerColor(index);
            const isSelected = selectedZimmers.size === 0 || selectedZimmers.has(zimmer.id);
            return (
              <button
                key={zimmer.id}
                onClick={() => onToggleZimmer(zimmer.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
                  isSelected ? 'bg-white shadow-sm' : 'bg-neutral-100 opacity-50'
                }`}
                style={{ borderColor: isSelected ? color : '#e5e5e5' }}
              >
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                <span className="max-w-[100px] truncate">{zimmer.name}</span>
              </button>
            );
          })}
        </div>

        {/* Status Legend */}
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-face-border">
          <span className="text-xs text-face-muted">מקרא סטטוס:</span>
          {(['available', 'maybe', 'occupied'] as DateStatus[]).map(status => (
            <div key={status} className="flex items-center gap-1 text-xs">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: statusColors[status] }} />
              <span>{statusLabels[status]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Calendar */}
      <div className="bg-white rounded-lg border border-face-border overflow-hidden">
        {/* Month Navigation */}
        <div className="flex items-center justify-between p-4 border-b border-face-border bg-gradient-to-l from-amber-50 to-white">
          <button
            onClick={() => onMonthChange(addDays(monthStart, -15))}
            className="p-2 hover:bg-neutral-100 rounded-lg transition-all"
          >
            <ChevronUp size={20} className="rotate-90" />
          </button>
          <div className="text-center">
            <h2 className="text-lg font-bold text-face-text">
              {format(month, 'MMMM yyyy', { locale: he })}
            </h2>
          </div>
          <button
            onClick={() => onMonthChange(addDays(monthEnd, 15))}
            className="p-2 hover:bg-neutral-100 rounded-lg transition-all"
          >
            <ChevronDown size={20} className="rotate-90" />
          </button>
        </div>

        {/* Day Headers */}
        <div className="grid grid-cols-7 border-b border-face-border">
          {hebrewDays.map((day, i) => (
            <div key={day} className={`p-2 text-center text-xs font-bold bg-neutral-50 ${i === 6 ? 'text-blue-600' : 'text-face-muted'}`}>
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7">
          {/* Empty cells */}
          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="min-h-[100px] p-1 bg-neutral-50/50 border-b border-l border-face-border" />
          ))}

          {/* Days */}
          {days.map(day => {
            const dateKey = format(day, 'yyyy-MM-dd');
            const isToday = isSameDay(day, new Date());
            const hebrewEvent = hebrewEvents.get(dateKey);
            const isShabbat = day.getDay() === 6;
            const hebrewDate = getHebrewDate(day);
            const isSelected = selectedDate === dateKey;

            return (
              <div
                key={dateKey}
                onClick={() => setSelectedDate(isSelected ? null : dateKey)}
                className={`min-h-[100px] p-1 border-b border-l border-face-border transition-all cursor-pointer ${
                  isToday ? 'bg-amber-50' : isShabbat ? 'bg-blue-50/50' : 'hover:bg-neutral-50'
                } ${isSelected ? 'ring-2 ring-whatsapp-primary ring-inset' : ''}`}
              >
                {/* Date Header */}
                <div className="flex justify-between items-start mb-1">
                  <span className={`text-sm font-bold ${isToday ? 'text-amber-600' : isShabbat ? 'text-blue-600' : 'text-face-text'}`}>
                    {format(day, 'd')}
                  </span>
                  <span className="text-[9px] text-face-muted">{hebrewDate}</span>
                </div>

                {/* Holiday / Parsha */}
                {(hebrewEvent?.holiday || hebrewEvent?.parsha) && (
                  <div className="mb-1">
                    {hebrewEvent.holiday && (
                      <div className="text-[9px] font-bold text-purple-600 truncate" title={hebrewEvent.holiday}>
                        {hebrewEvent.holiday}
                      </div>
                    )}
                    {hebrewEvent.parsha && isShabbat && (
                      <div className="text-[9px] text-blue-600 truncate" title={hebrewEvent.parsha}>
                        {hebrewEvent.parsha}
                      </div>
                    )}
                  </div>
                )}

                {/* Zimmer Status Dots */}
                <div className="flex flex-wrap gap-0.5">
                  {visibleZimmers.map((zimmer, index) => {
                    const status = getDateStatus(zimmer, dateKey);
                    const isOwner = zimmer.ownerUid === currentUserId || isAdminProp;
                    const color = getZimmerColor(index);

                    return (
                      <button
                        key={zimmer.id}
                        onClick={() => {
                          if (isOwner) {
                            const newStatus = cycleStatus(status);
                            onUpdateDateStatus(zimmer.id, dateKey, newStatus);
                          }
                        }}
                        disabled={!isOwner}
                        className={`w-4 h-4 rounded-full border-2 transition-all ${
                          isOwner ? 'cursor-pointer hover:scale-125' : 'cursor-default opacity-70'
                        }`}
                        style={{
                          backgroundColor: status === 'available' ? 'white' : statusColors[status],
                          borderColor: color
                        }}
                        title={`${zimmer.name}: ${statusLabels[status]}${isOwner ? ' (לחץ לשינוי)' : ''}`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Date Popup */}
      {selectedDate && (
        <div className="bg-white rounded-lg border border-face-border p-4 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-face-text flex items-center gap-2">
              <CalendarIcon size={16} className="text-whatsapp-primary" />
              סטטוס צימרים ליום {format(parseISO(selectedDate), 'd בMMMM yyyy', { locale: he })}
            </h3>
            <button
              onClick={() => setSelectedDate(null)}
              className="p-1 hover:bg-neutral-100 rounded-full transition-all"
            >
              <X size={16} className="text-face-muted" />
            </button>
          </div>
          <div className="space-y-2">
            {visibleZimmers.map((zimmer, index) => {
              const status = getDateStatus(zimmer, selectedDate);
              const color = getZimmerColor(index);
              const isOwner = zimmer.ownerUid === currentUserId || isAdminProp;

              return (
                <div
                  key={zimmer.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-neutral-50 transition-all"
                >
                  <div
                    className="w-8 h-8 rounded-full border-3 flex items-center justify-center font-bold text-white text-xs"
                    style={{
                      backgroundColor: status === 'available' ? 'white' : statusColors[status],
                      borderColor: color,
                      borderWidth: '3px',
                      color: status === 'available' ? color : 'white'
                    }}
                    title={zimmer.name}
                  >
                    {zimmer.name.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-sm">{zimmer.name}</div>
                    <div className="text-xs text-face-muted">{zimmer.location}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-bold px-2 py-1 rounded-full"
                      style={{
                        backgroundColor: status === 'available' ? '#dcfce7' : status === 'maybe' ? '#fef3c7' : '#fee2e2',
                        color: status === 'available' ? '#166534' : status === 'maybe' ? '#92400e' : '#991b1b'
                      }}
                    >
                      {statusLabels[status]}
                    </span>
                    {isOwner && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const newStatus = cycleStatus(status);
                          onUpdateDateStatus(zimmer.id, selectedDate, newStatus);
                        }}
                        className="text-xs px-2 py-1 bg-whatsapp-primary text-white rounded hover:bg-whatsapp-dark transition-all"
                      >
                        שנה
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="bg-white rounded-lg border border-face-border p-4">
        <h3 className="text-sm font-bold text-face-text mb-3">מקרא צימרים</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {visibleZimmers.map((zimmer, index) => {
            const color = getZimmerColor(index);
            const isOwner = zimmer.ownerUid === currentUserId;
            return (
              <div key={zimmer.id} className="flex items-center gap-2 text-xs">
                <div className="w-4 h-4 rounded-full border-2 flex-shrink-0" style={{ borderColor: color, backgroundColor: 'white' }} />
                <div className="min-w-0">
                  <div className="font-bold truncate">{zimmer.name}</div>
                  <div className="text-face-muted truncate">{zimmer.location}</div>
                  {isOwner && <div className="text-whatsapp-primary text-[10px]">שלי</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Statistics View Component
interface StatsViewProps {
  zimmers: ZimmerAvailability[];
  requests: CustomerRequest[];
}

function StatsView({ zimmers, requests }: StatsViewProps) {
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  // Calculate statistics
  const stats = useMemo(() => {
    // Count occupied dates by day of week
    const dayOfWeekCounts: number[] = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
    const monthCounts: { [key: string]: number } = {};
    const weekCounts: { [key: string]: number } = {};

    // Total occupied dates this month
    let occupiedThisMonth = 0;
    let maybeThisMonth = 0;

    zimmers.forEach(zimmer => {
      const statuses = zimmer.dateStatuses || {};
      Object.entries(statuses).forEach(([dateStr, status]) => {
        if (status === 'available') return;

        try {
          const date = parseISO(dateStr);
          if (!isValid(date)) return;

          // Day of week
          dayOfWeekCounts[date.getDay()]++;

          // Month key
          const monthKey = format(date, 'yyyy-MM');
          monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1;

          // Week key
          const weekStart = startOfMonth(date);
          const weekNum = Math.floor((date.getDate() - 1) / 7);
          const weekKey = `${format(date, 'yyyy-MM')}-W${weekNum + 1}`;
          weekCounts[weekKey] = (weekCounts[weekKey] || 0) + 1;

          // This month stats
          if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) {
            if (status === 'occupied') occupiedThisMonth++;
            else if (status === 'maybe') maybeThisMonth++;
          }
        } catch {}
      });

      // Also count legacy disabledDates
      (zimmer.disabledDates || []).forEach(dateStr => {
        try {
          const date = parseISO(dateStr);
          if (!isValid(date)) return;
          dayOfWeekCounts[date.getDay()]++;

          if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) {
            occupiedThisMonth++;
          }
        } catch {}
      });
    });

    // Find busiest day of week
    const hebrewDayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    const maxDayIndex = dayOfWeekCounts.indexOf(Math.max(...dayOfWeekCounts));
    const busiestDay = hebrewDayNames[maxDayIndex];

    // Sort months by count
    const sortedMonths = Object.entries(monthCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    // Location stats (zimmers)
    const locationCounts: { [key: string]: number } = {};
    zimmers.forEach(z => {
      locationCounts[z.location] = (locationCounts[z.location] || 0) + 1;
    });
    const topLocations = Object.entries(locationCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Request statistics
    const requestLocationCounts: { [key: string]: number } = {};
    const roomsNeededCounts: { [key: string]: number } = { '1-2': 0, '3-4': 0, '5+': 0 };
    const bedsNeededCounts: { [key: string]: number } = { '1-4': 0, '5-8': 0, '9+': 0 };
    let totalBudget = 0;
    let budgetCount = 0;

    requests.forEach(req => {
      // Location preferences
      if (req.locationPref) {
        requestLocationCounts[req.locationPref] = (requestLocationCounts[req.locationPref] || 0) + 1;
      }

      // Rooms needed
      if (req.roomsNeeded <= 2) roomsNeededCounts['1-2']++;
      else if (req.roomsNeeded <= 4) roomsNeededCounts['3-4']++;
      else roomsNeededCounts['5+']++;

      // Beds needed
      if (req.bedsNeeded <= 4) bedsNeededCounts['1-4']++;
      else if (req.bedsNeeded <= 8) bedsNeededCounts['5-8']++;
      else bedsNeededCounts['9+']++;

      // Budget average
      if (req.budget) {
        const numMatch = req.budget.match(/(\d+)/);
        if (numMatch) {
          totalBudget += parseInt(numMatch[1]);
          budgetCount++;
        }
      }
    });

    const topRequestLocations = Object.entries(requestLocationCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const avgBudget = budgetCount > 0 ? Math.round(totalBudget / budgetCount) : 0;

    return {
      totalZimmers: zimmers.length,
      totalRequests: requests.length,
      occupiedThisMonth,
      maybeThisMonth,
      busiestDay,
      dayOfWeekCounts,
      hebrewDayNames,
      sortedMonths,
      topLocations,
      topRequestLocations,
      roomsNeededCounts,
      bedsNeededCounts,
      avgBudget
    };
  }, [zimmers, requests, currentMonth, currentYear]);

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-face-border p-4 text-center">
          <div className="text-3xl font-extrabold text-whatsapp-primary">{stats.totalZimmers}</div>
          <div className="text-xs text-face-muted font-bold">צימרים במערכת</div>
        </div>
        <div className="bg-white rounded-lg border border-face-border p-4 text-center">
          <div className="text-3xl font-extrabold text-[#1877F2]">{stats.totalRequests}</div>
          <div className="text-xs text-face-muted font-bold">ביקושים פעילים</div>
        </div>
        <div className="bg-white rounded-lg border border-face-border p-4 text-center">
          <div className="text-3xl font-extrabold text-red-500">{stats.occupiedThisMonth}</div>
          <div className="text-xs text-face-muted font-bold">תפוסים החודש</div>
        </div>
        <div className="bg-white rounded-lg border border-face-border p-4 text-center">
          <div className="text-3xl font-extrabold text-amber-500">{stats.maybeThisMonth}</div>
          <div className="text-xs text-face-muted font-bold">אולי תפוסים החודש</div>
        </div>
      </div>

      {/* Busiest Day */}
      <div className="bg-white rounded-lg border border-face-border p-4">
        <h3 className="text-sm font-bold text-face-text mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-purple-500" />
          היום העמוס ביותר
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-extrabold text-purple-600">יום {stats.busiestDay}</div>
            <div className="text-xs text-face-muted">הכי הרבה הזמנות</div>
          </div>
          <div className="flex gap-1">
            {stats.dayOfWeekCounts.map((count, i) => (
              <div key={i} className="flex flex-col items-center">
                <div
                  className="w-8 bg-purple-200 rounded-t"
                  style={{ height: `${Math.max(4, count * 8)}px` }}
                />
                <div className="text-[9px] text-face-muted mt-1">{stats.hebrewDayNames[i].charAt(0)}׳</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Locations */}
      <div className="bg-white rounded-lg border border-face-border p-4">
        <h3 className="text-sm font-bold text-face-text mb-4 flex items-center gap-2">
          <MapPin size={16} className="text-whatsapp-primary" />
          מיקומים פופולריים
        </h3>
        <div className="space-y-2">
          {stats.topLocations.length === 0 ? (
            <div className="text-sm text-face-muted italic">אין נתונים עדיין</div>
          ) : (
            stats.topLocations.map(([location, count], i) => (
              <div key={location} className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  i === 0 ? 'bg-amber-100 text-amber-700' :
                  i === 1 ? 'bg-neutral-200 text-neutral-600' :
                  'bg-orange-100 text-orange-600'
                }`}>
                  {i + 1}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold">{location}</div>
                </div>
                <div className="text-sm font-bold text-whatsapp-primary">{count} צימרים</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Monthly Trend */}
      {stats.sortedMonths.length > 0 && (
        <div className="bg-white rounded-lg border border-face-border p-4">
          <h3 className="text-sm font-bold text-face-text mb-4 flex items-center gap-2">
            <BarChart3 size={16} className="text-blue-500" />
            חודשים עמוסים
          </h3>
          <div className="space-y-2">
            {stats.sortedMonths.map(([monthKey, count]) => {
              const [year, month] = monthKey.split('-');
              const date = new Date(parseInt(year), parseInt(month) - 1);
              const monthName = format(date, 'MMMM yyyy', { locale: he });

              return (
                <div key={monthKey} className="flex items-center gap-3">
                  <div className="text-sm font-bold w-32">{monthName}</div>
                  <div className="flex-1 bg-neutral-100 rounded-full h-4 overflow-hidden">
                    <div
                      className="bg-blue-500 h-full rounded-full"
                      style={{ width: `${Math.min(100, (count / Math.max(...stats.sortedMonths.map(m => m[1]))) * 100)}%` }}
                    />
                  </div>
                  <div className="text-sm font-bold text-blue-600 w-12 text-left">{count}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Request Statistics Header */}
      <div className="border-t border-face-border pt-4 mt-6">
        <h2 className="text-lg font-bold text-[#1877F2] mb-4 flex items-center gap-2">
          <Users size={20} />
          סטטיסטיקות ביקושים
        </h2>
      </div>

      {/* Request Location Preferences */}
      <div className="bg-white rounded-lg border border-face-border p-4">
        <h3 className="text-sm font-bold text-face-text mb-4 flex items-center gap-2">
          <MapPin size={16} className="text-[#1877F2]" />
          מיקומים מבוקשים
        </h3>
        <div className="space-y-2">
          {stats.topRequestLocations.length === 0 ? (
            <div className="text-sm text-face-muted italic">אין נתונים עדיין</div>
          ) : (
            stats.topRequestLocations.map(([location, count], i) => (
              <div key={location} className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  i === 0 ? 'bg-blue-100 text-blue-700' :
                  i === 1 ? 'bg-blue-50 text-blue-600' :
                  'bg-neutral-100 text-neutral-600'
                }`}>
                  {i + 1}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold">{location}</div>
                </div>
                <div className="text-sm font-bold text-[#1877F2]">{count} ביקושים</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Room & Bed Requirements */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border border-face-border p-4">
          <h3 className="text-sm font-bold text-face-text mb-3 flex items-center gap-2">
            <Home size={16} className="text-indigo-500" />
            חדרים נדרשים
          </h3>
          <div className="space-y-2">
            {Object.entries(stats.roomsNeededCounts).map(([range, count]) => (
              <div key={range} className="flex items-center justify-between">
                <span className="text-sm">{range} חדרים</span>
                <div className="flex items-center gap-2">
                  <div className="w-20 bg-neutral-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-indigo-500 h-full rounded-full"
                      style={{ width: `${stats.totalRequests > 0 ? (count / stats.totalRequests) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold text-indigo-600 w-6">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-face-border p-4">
          <h3 className="text-sm font-bold text-face-text mb-3 flex items-center gap-2">
            <Bed size={16} className="text-pink-500" />
            מיטות נדרשות
          </h3>
          <div className="space-y-2">
            {Object.entries(stats.bedsNeededCounts).map(([range, count]) => (
              <div key={range} className="flex items-center justify-between">
                <span className="text-sm">{range} מיטות</span>
                <div className="flex items-center gap-2">
                  <div className="w-20 bg-neutral-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-pink-500 h-full rounded-full"
                      style={{ width: `${stats.totalRequests > 0 ? (count / stats.totalRequests) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold text-pink-600 w-6">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Average Budget */}
      {stats.avgBudget > 0 && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-200 p-4">
          <h3 className="text-sm font-bold text-green-800 mb-2 flex items-center gap-2">
            <DollarSign size={16} />
            תקציב ממוצע
          </h3>
          <div className="text-2xl font-extrabold text-green-600">
            ₪{stats.avgBudget.toLocaleString()}
          </div>
          <div className="text-xs text-green-700">לפי {stats.totalRequests} ביקושים</div>
        </div>
      )}

      {/* Quick Info */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-100 p-4">
        <h3 className="text-sm font-bold text-purple-800 mb-2">💡 תובנה</h3>
        <p className="text-xs text-purple-700 leading-relaxed">
          {stats.busiestDay === 'שבת' || stats.busiestDay === 'שישי'
            ? 'סופי השבוע הם התקופה העמוסה ביותר - כדאי לוודא שיש מספיק צימרים זמינים!'
            : stats.busiestDay === 'חמישי'
            ? 'ימי חמישי פופולריים - אולי כדאי להציע חבילות לסוף שבוע ארוך'
            : 'הביקוש מתפזר לאורך השבוע - הזדמנות להציע מחירים מיוחדים באמצע השבוע'
          }
        </p>
      </div>
    </div>
  );
}

// Admin View Component
interface AdminViewProps {
  zimmers: ZimmerAvailability[];
  requests: CustomerRequest[];
  onUpdateZimmer: (id: string, updates: Partial<ZimmerAvailability>) => Promise<void>;
  onDeleteZimmer: (id: string) => Promise<void>;
}

function AdminView({ zimmers, requests, onUpdateZimmer, onDeleteZimmer }: AdminViewProps) {
  const [selectedZimmer, setSelectedZimmer] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [adminTab, setAdminTab] = useState<'zimmers' | 'customers'>('zimmers');

  // Extract unique customers from requests
  const customers = useMemo(() => {
    const customerMap = new Map<string, { name: string; phone: string; requestCount: number; locations: Set<string> }>();

    for (const req of requests) {
      const phone = req.contactInfo?.replace(/\D/g, '') || '';
      if (!phone) continue;

      if (customerMap.has(phone)) {
        const existing = customerMap.get(phone)!;
        existing.requestCount++;
        if (req.locationPref) existing.locations.add(req.locationPref);
      } else {
        customerMap.set(phone, {
          name: req.customerName,
          phone: req.contactInfo || phone,
          requestCount: 1,
          locations: new Set(req.locationPref ? [req.locationPref] : [])
        });
      }
    }

    return Array.from(customerMap.values()).sort((a, b) => b.requestCount - a.requestCount);
  }, [requests]);

  const monthStart = startOfMonth(calendarMonth);
  const monthEnd = endOfMonth(calendarMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const firstDayOfWeek = monthStart.getDay();

  const selectedZimmerData = zimmers.find(z => z.id === selectedZimmer);

  const getDateStatus = (dateKey: string): DateStatus => {
    if (!selectedZimmerData) return 'available';
    if (selectedZimmerData.dateStatuses && selectedZimmerData.dateStatuses[dateKey]) {
      return selectedZimmerData.dateStatuses[dateKey];
    }
    if (selectedZimmerData.disabledDates?.includes(dateKey)) {
      return 'occupied';
    }
    return 'available';
  };

  const cycleStatus = (current: DateStatus): DateStatus => {
    if (current === 'available') return 'occupied';
    if (current === 'occupied') return 'maybe';
    return 'available';
  };

  const handleDateClick = async (dateKey: string) => {
    if (!selectedZimmer || !selectedZimmerData) return;
    const currentStatus = getDateStatus(dateKey);
    const newStatus = cycleStatus(currentStatus);
    const newStatuses = { ...(selectedZimmerData.dateStatuses || {}), [dateKey]: newStatus };
    if (newStatus === 'available') delete newStatuses[dateKey];
    await onUpdateZimmer(selectedZimmer, { dateStatuses: newStatuses });
  };

  const statusColors: Record<DateStatus, string> = {
    available: '#22c55e',
    maybe: '#f59e0b',
    occupied: '#ef4444'
  };

  const hebrewDays = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

  return (
    <div className="space-y-4">
      {/* Admin Header */}
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-sm font-bold text-red-800 flex items-center gap-2">
          <Settings size={16} />
          ניהול מערכת - מנהל
        </h3>
        <p className="text-xs text-red-600 mt-1">באזור זה תוכל לנהל צימרים, לקוחות ולסמן תאריכים</p>
      </div>

      {/* Admin Tabs */}
      <div className="flex gap-2 bg-white p-2 rounded-lg border border-face-border">
        <button
          onClick={() => setAdminTab('zimmers')}
          className={`flex-1 py-2 px-4 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${
            adminTab === 'zimmers' ? 'bg-red-100 text-red-700' : 'bg-neutral-50 text-face-muted hover:bg-neutral-100'
          }`}
        >
          <Home size={16} />
          ניהול צימרים ({zimmers.length})
        </button>
        <button
          onClick={() => setAdminTab('customers')}
          className={`flex-1 py-2 px-4 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${
            adminTab === 'customers' ? 'bg-blue-100 text-blue-700' : 'bg-neutral-50 text-face-muted hover:bg-neutral-100'
          }`}
        >
          <Users size={16} />
          לקוחות ({customers.length})
        </button>
      </div>

      {/* Customers Tab */}
      {adminTab === 'customers' && (
        <div className="bg-white rounded-lg border border-face-border overflow-hidden">
          <div className="p-4 border-b border-face-border bg-blue-50">
            <h3 className="text-sm font-bold text-blue-800 flex items-center gap-2">
              <Users size={16} />
              רשימת לקוחות מהביקושים
            </h3>
            <p className="text-xs text-blue-600 mt-1">סה״כ {customers.length} לקוחות ייחודיים מתוך {requests.length} ביקושים</p>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            <table className="w-full">
              <thead className="bg-neutral-50 sticky top-0">
                <tr>
                  <th className="text-right text-xs font-bold text-face-muted p-3 border-b border-face-border">#</th>
                  <th className="text-right text-xs font-bold text-face-muted p-3 border-b border-face-border">שם</th>
                  <th className="text-right text-xs font-bold text-face-muted p-3 border-b border-face-border">טלפון</th>
                  <th className="text-right text-xs font-bold text-face-muted p-3 border-b border-face-border">ביקושים</th>
                  <th className="text-right text-xs font-bold text-face-muted p-3 border-b border-face-border">מיקומים מועדפים</th>
                  <th className="text-right text-xs font-bold text-face-muted p-3 border-b border-face-border">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer, index) => (
                  <tr key={customer.phone} className="hover:bg-neutral-50 border-b border-face-border last:border-b-0">
                    <td className="p-3 text-xs text-face-muted">{index + 1}</td>
                    <td className="p-3">
                      <span className="font-bold text-sm text-face-text">{customer.name}</span>
                    </td>
                    <td className="p-3">
                      <span className="text-sm font-mono bg-neutral-100 px-2 py-1 rounded">{customer.phone}</span>
                    </td>
                    <td className="p-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                        customer.requestCount >= 3 ? 'bg-emerald-100 text-emerald-700' :
                        customer.requestCount >= 2 ? 'bg-yellow-100 text-yellow-700' :
                        'bg-neutral-100 text-neutral-600'
                      }`}>
                        {customer.requestCount}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {Array.from(customer.locations).slice(0, 3).map(loc => (
                          <span key={loc} className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{loc}</span>
                        ))}
                        {customer.locations.size > 3 && (
                          <span className="text-[10px] text-face-muted">+{customer.locations.size - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <a
                          href={`tel:${customer.phone}`}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-all"
                          title="התקשר"
                        >
                          <Phone size={14} />
                        </a>
                        <a
                          href={`https://wa.me/972${customer.phone.replace(/^0/, '').replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-whatsapp-primary hover:bg-green-50 rounded transition-all"
                          title="וואטסאפ"
                        >
                          <MessageCircle size={14} />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {customers.length === 0 && (
              <div className="p-8 text-center text-face-muted">
                <Users size={48} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">אין לקוחות להצגה</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Zimmers Tab */}
      {adminTab === 'zimmers' && (
      <>
      {/* Zimmer Selector */}
      <div className="bg-white rounded-lg border border-face-border p-4">
        <h3 className="text-sm font-bold text-face-text mb-3">בחר צימר לעריכת לוח שנה</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {zimmers.map((zimmer, index) => (
            <button
              key={zimmer.id}
              onClick={() => setSelectedZimmer(selectedZimmer === zimmer.id ? null : zimmer.id)}
              className={`p-3 rounded-lg border text-right transition-all ${
                selectedZimmer === zimmer.id
                  ? 'border-red-500 bg-red-50'
                  : 'border-face-border hover:border-neutral-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getZimmerColor(index) }} />
                <span className="text-sm font-bold truncate">{zimmer.name}</span>
              </div>
              <div className="text-[10px] text-face-muted truncate">{zimmer.location}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Calendar for selected zimmer */}
      {selectedZimmerData && (
        <div className="bg-white rounded-lg border border-face-border overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-face-border bg-red-50">
            <button
              onClick={() => setCalendarMonth(addDays(monthStart, -15))}
              className="p-2 hover:bg-red-100 rounded-lg transition-all"
            >
              <ChevronUp size={20} className="rotate-90" />
            </button>
            <div className="text-center">
              <h2 className="text-lg font-bold text-red-800">
                {selectedZimmerData.name} - {format(calendarMonth, 'MMMM yyyy', { locale: he })}
              </h2>
              <p className="text-xs text-red-600">לחץ על תאריך לשינוי סטטוס</p>
            </div>
            <button
              onClick={() => setCalendarMonth(addDays(monthEnd, 15))}
              className="p-2 hover:bg-red-100 rounded-lg transition-all"
            >
              <ChevronDown size={20} className="rotate-90" />
            </button>
          </div>

          {/* Status Legend */}
          <div className="flex items-center justify-center gap-4 p-2 bg-neutral-50 border-b border-face-border">
            {(['available', 'occupied', 'maybe'] as DateStatus[]).map(status => (
              <div key={status} className="flex items-center gap-1 text-xs">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: statusColors[status] }} />
                <span>{status === 'available' ? 'פנוי' : status === 'occupied' ? 'תפוס' : 'אולי'}</span>
              </div>
            ))}
          </div>

          {/* Day Headers */}
          <div className="grid grid-cols-7 border-b border-face-border">
            {hebrewDays.map(day => (
              <div key={day} className="p-2 text-center text-xs font-bold text-face-muted bg-neutral-50">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7">
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[60px] p-2 bg-neutral-50/50 border-b border-l border-face-border" />
            ))}
            {days.map(day => {
              const dateKey = format(day, 'yyyy-MM-dd');
              const status = getDateStatus(dateKey);
              const isToday = isSameDay(day, new Date());

              return (
                <button
                  key={dateKey}
                  onClick={() => handleDateClick(dateKey)}
                  className={`min-h-[60px] p-2 border-b border-l border-face-border transition-all hover:opacity-80 ${
                    isToday ? 'ring-2 ring-amber-400 ring-inset' : ''
                  }`}
                  style={{ backgroundColor: status === 'available' ? 'white' : statusColors[status] + '40' }}
                >
                  <div className={`text-sm font-bold ${status !== 'available' ? 'text-neutral-800' : 'text-face-text'}`}>
                    {format(day, 'd')}
                  </div>
                  {status !== 'available' && (
                    <div className="text-[9px] font-bold mt-1" style={{ color: statusColors[status] }}>
                      {status === 'occupied' ? 'תפוס' : 'אולי'}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Zimmer List Management */}
      <div className="bg-white rounded-lg border border-face-border p-4">
        <h3 className="text-sm font-bold text-face-text mb-3 flex items-center gap-2">
          <Home size={16} />
          ניהול צימרים ({zimmers.length})
        </h3>
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {zimmers.map((zimmer, index) => (
            <div key={zimmer.id} className="flex items-center justify-between p-3 bg-neutral-50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: getZimmerColor(index) }} />
                <div>
                  <div className="text-sm font-bold">{zimmer.name}</div>
                  <div className="text-[10px] text-face-muted">{zimmer.location} | {zimmer.rooms} חדרים | {zimmer.beds} מיטות</div>
                </div>
              </div>
              <button
                onClick={() => {
                  if (confirm(`למחוק את ${zimmer.name}?`)) {
                    onDeleteZimmer(zimmer.id);
                  }
                }}
                className="p-2 text-red-500 hover:bg-red-50 rounded transition-all"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>
      </>
      )}
    </div>
  );
}
