export type DateStatus = 'available' | 'occupied' | 'maybe';

// יחידת נופש - תת-צימר עם לוח תפוסה נפרד
export interface ZimmerUnit {
  id: string;
  name: string;                                    // "סוויטה רומנטית"
  beds: number;
  rooms: number;
  price?: string;
  notes?: string;
  dateStatuses?: { [date: string]: DateStatus };   // לוח תפוסה נפרד ליחידה
}

export interface ZimmerAvailability {
  id: string;
  ownerUid?: string;
  name: string;
  location: string;
  dates: string;
  rooms: number;
  beds: number;
  price?: string;
  contactInfo?: string;
  notes?: string;
  logo?: string;
  images?: string[]; // Array of image URLs (up to 3)
  disabledDates?: string[]; // Array of ISO date strings (legacy)
  dateStatuses?: { [date: string]: DateStatus }; // Default status (for zimmers without units)
  units?: ZimmerUnit[]; // יחידות נופש (עד 5)
  updatedAt?: string;
}

export interface CustomerRequest {
  id: string;
  createdBy?: string;
  customerName: string;
  locationPref?: string;
  dates: string;
  roomsNeeded: number;
  bedsNeeded: number;
  budget?: string;
  contactInfo?: string;
  notes?: string;
  updatedAt?: string;
  claimedBy?: {
    uid: string;
    name: string;
    logo?: string;
    claimedAt: string;
  };
}

export interface ParsedData {
  zimmers: Omit<ZimmerAvailability, 'id'>[];
  requests: Omit<CustomerRequest, 'id'>[];
}

export type UserRole = 'owner' | 'customer' | 'admin';

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  role: UserRole;
  zimmerDetails?: {
    name: string;
    phone: string;
    beds: number;
    rooms: number;
    location: string;
    website?: string;
    logo?: string;
    images?: string[]; // Array of image URLs (up to 3)
    notes?: string;
  };
  createdAt?: string;
}
