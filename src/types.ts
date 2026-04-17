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
  disabledDates?: string[]; // Array of ISO date strings
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
}

export interface ParsedData {
  zimmers: Omit<ZimmerAvailability, 'id'>[];
  requests: Omit<CustomerRequest, 'id'>[];
}
