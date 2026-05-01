import { gapi } from 'gapi-script';
import { GOOGLE_CALENDAR_CONFIG } from '../config/google-calendar';

// Types
export interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  start: { date: string }; // All-day event
  end: { date: string };
  colorId?: string;
}

// Initialize the Google API client
export const initGoogleCalendar = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    const script = document.getElementById('google-api-script');

    if (!script) {
      const newScript = document.createElement('script');
      newScript.id = 'google-api-script';
      newScript.src = 'https://apis.google.com/js/api.js';
      newScript.onload = () => {
        gapi.load('client:auth2', async () => {
          try {
            await gapi.client.init({
              clientId: GOOGLE_CALENDAR_CONFIG.clientId,
              scope: GOOGLE_CALENDAR_CONFIG.scopes,
              discoveryDocs: GOOGLE_CALENDAR_CONFIG.discoveryDocs,
            });
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      };
      newScript.onerror = reject;
      document.body.appendChild(newScript);
    } else {
      // Script already loaded
      if (gapi.client) {
        resolve();
      } else {
        gapi.load('client:auth2', async () => {
          try {
            await gapi.client.init({
              clientId: GOOGLE_CALENDAR_CONFIG.clientId,
              scope: GOOGLE_CALENDAR_CONFIG.scopes,
              discoveryDocs: GOOGLE_CALENDAR_CONFIG.discoveryDocs,
            });
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      }
    }
  });
};

// Check if user is signed in to Google Calendar
export const isCalendarSignedIn = (): boolean => {
  try {
    const authInstance = gapi.auth2?.getAuthInstance();
    return authInstance?.isSignedIn?.get() || false;
  } catch {
    return false;
  }
};

// Sign in to Google Calendar
export const signInToCalendar = async (): Promise<boolean> => {
  try {
    await initGoogleCalendar();
    const authInstance = gapi.auth2.getAuthInstance();
    await authInstance.signIn();
    return true;
  } catch (error) {
    console.error('Error signing in to Google Calendar:', error);
    return false;
  }
};

// Sign out from Google Calendar
export const signOutFromCalendar = async (): Promise<void> => {
  try {
    const authInstance = gapi.auth2?.getAuthInstance();
    if (authInstance) {
      await authInstance.signOut();
    }
  } catch (error) {
    console.error('Error signing out from Google Calendar:', error);
  }
};

// Get the user's calendar list
export const getCalendarList = async (): Promise<any[]> => {
  try {
    const response = await gapi.client.calendar.calendarList.list();
    return response.result.items || [];
  } catch (error) {
    console.error('Error getting calendar list:', error);
    return [];
  }
};

// Create or update a calendar event for a zimmer booking
export const syncZimmerToCalendar = async (
  zimmerName: string,
  dateKey: string, // yyyy-MM-dd format
  status: 'occupied' | 'maybe' | 'available',
  existingEventId?: string,
  calendarId: string = 'primary'
): Promise<string | null> => {
  try {
    // If status is 'available', delete the event if it exists
    if (status === 'available') {
      if (existingEventId) {
        await deleteCalendarEvent(existingEventId, calendarId);
      }
      return null;
    }

    // Create event for occupied or maybe status
    const event: CalendarEvent = {
      summary: `${zimmerName} - ${status === 'occupied' ? 'תפוס' : 'אולי תפוס'}`,
      description: `סטטוס צימר: ${status === 'occupied' ? 'תפוס' : 'אולי תפוס'}\nמקור: ZimmerSync`,
      start: { date: dateKey },
      end: { date: getNextDay(dateKey) },
      colorId: status === 'occupied' ? '11' : '5', // Red for occupied, Yellow for maybe
    };

    if (existingEventId) {
      // Update existing event
      const response = await gapi.client.calendar.events.update({
        calendarId,
        eventId: existingEventId,
        resource: event,
      });
      return response.result.id;
    } else {
      // Create new event
      const response = await gapi.client.calendar.events.insert({
        calendarId,
        resource: event,
      });
      return response.result.id;
    }
  } catch (error) {
    console.error('Error syncing to calendar:', error);
    return null;
  }
};

// Delete a calendar event
export const deleteCalendarEvent = async (
  eventId: string,
  calendarId: string = 'primary'
): Promise<boolean> => {
  try {
    await gapi.client.calendar.events.delete({
      calendarId,
      eventId,
    });
    return true;
  } catch (error) {
    console.error('Error deleting calendar event:', error);
    return false;
  }
};

// Get all ZimmerSync events from calendar (for sync)
export const getZimmerSyncEvents = async (
  calendarId: string = 'primary',
  timeMin?: string,
  timeMax?: string
): Promise<any[]> => {
  try {
    const params: any = {
      calendarId,
      q: 'ZimmerSync', // Search for events created by ZimmerSync
      singleEvents: true,
      orderBy: 'startTime',
    };

    if (timeMin) params.timeMin = timeMin;
    if (timeMax) params.timeMax = timeMax;

    const response = await gapi.client.calendar.events.list(params);
    return response.result.items || [];
  } catch (error) {
    console.error('Error getting ZimmerSync events:', error);
    return [];
  }
};

// Sync all occupied dates to Google Calendar
export const syncAllDatesToCalendar = async (
  zimmerName: string,
  dateStatuses: { [date: string]: 'available' | 'occupied' | 'maybe' },
  existingEventIds: { [date: string]: string } = {},
  calendarId: string = 'primary'
): Promise<{ [date: string]: string }> => {
  const newEventIds: { [date: string]: string } = { ...existingEventIds };

  for (const [dateKey, status] of Object.entries(dateStatuses)) {
    const existingId = existingEventIds[dateKey];
    const newId = await syncZimmerToCalendar(
      zimmerName,
      dateKey,
      status,
      existingId,
      calendarId
    );

    if (newId) {
      newEventIds[dateKey] = newId;
    } else if (existingId) {
      delete newEventIds[dateKey];
    }
  }

  return newEventIds;
};

// Helper: Get next day in yyyy-MM-dd format
function getNextDay(dateKey: string): string {
  const date = new Date(dateKey);
  date.setDate(date.getDate() + 1);
  return date.toISOString().split('T')[0];
}

// Get current user's email from Google auth
export const getCalendarUserEmail = (): string | null => {
  try {
    const authInstance = gapi.auth2?.getAuthInstance();
    if (authInstance?.isSignedIn?.get()) {
      const profile = authInstance.currentUser.get().getBasicProfile();
      return profile.getEmail();
    }
    return null;
  } catch {
    return null;
  }
};
