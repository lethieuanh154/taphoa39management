import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject, BehaviorSubject, firstValueFrom } from 'rxjs';
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getFirestore, collection, onSnapshot, query, where, orderBy,
  Firestore, Unsubscribe
} from 'firebase/firestore';
import { environment } from '../../environments/environment';

export interface ChatMessage {
  id?: string;
  senderId: string;
  senderName: string;
  senderType: 'customer' | 'staff';
  message: string;
  conversationId: string;
  timestamp: string;
}

export interface Conversation {
  conversationId: string;
  senderName: string;
  conversationCode?: string;
  contactNumber?: string;
  lastMessage: string;
  lastTimestamp: string;
  senderType: string;
  unreadCount?: number;
}

@Injectable({ providedIn: 'root' })
export class ChatService implements OnDestroy {
  private newMessage$ = new Subject<ChatMessage>();
  private conversations$ = new BehaviorSubject<Conversation[]>([]);
  private activeMessages$ = new BehaviorSubject<ChatMessage[]>([]);
  private unreadTotal$ = new BehaviorSubject<number>(0);
  private activeConversationId: string | null = null;

  private chatApp: FirebaseApp | null = null;
  private chatDb: Firestore | null = null;
  private allMessagesUnsub: Unsubscribe | null = null;
  private conversationUnsub: Unsubscribe | null = null;
  private knownMessageIds = new Set<string>();
  private isInitialSnapshot = true;
  private customerInfoCache = new Map<string, { conversationCode?: string; contactNumber?: string; senderName?: string }>();

  constructor(private http: HttpClient) {}

  connect(): void {
    if (this.allMessagesUnsub) return;

    this.initFirestore();
    if (!this.chatDb) return;

    const messagesRef = collection(this.chatDb, 'chatMessages');
    const q = query(messagesRef, orderBy('timestamp', 'desc'));

    this.isInitialSnapshot = true;

    this.allMessagesUnsub = onSnapshot(q, (snapshot) => {
      if (this.isInitialSnapshot) {
        this.isInitialSnapshot = false;
        const allMsgs: ChatMessage[] = [];
        snapshot.docs.forEach(doc => {
          const msg = this.docToMessage(doc.id, doc.data());
          this.knownMessageIds.add(doc.id);
          allMsgs.push(msg);
        });
        this.buildConversationsFromMessages(allMsgs);
        return;
      }

      snapshot.docChanges().forEach(change => {
        if (change.type === 'added' && !this.knownMessageIds.has(change.doc.id)) {
          this.knownMessageIds.add(change.doc.id);
          const msg = this.docToMessage(change.doc.id, change.doc.data());
          this.newMessage$.next(msg);

          if (this.activeConversationId && msg.conversationId === this.activeConversationId) {
            const current = this.activeMessages$.value;
            this.activeMessages$.next([...current, msg]);
          }

          this.updateConversationFromMessage(msg);
        }
      });
    }, (error) => {
      console.error('[ChatService] Firestore onSnapshot error:', error);
    });
  }

  disconnect(): void {
    this.allMessagesUnsub?.();
    this.allMessagesUnsub = null;
    this.conversationUnsub?.();
    this.conversationUnsub = null;
    this.knownMessageIds.clear();
    this.isInitialSnapshot = true;
  }

  getNewMessage$() { return this.newMessage$.asObservable(); }
  getConversations$() { return this.conversations$.asObservable(); }
  getActiveMessages$() { return this.activeMessages$.asObservable(); }
  getUnreadTotal$() { return this.unreadTotal$.asObservable(); }

  async loadConversations(): Promise<Conversation[]> {
    const convs = await firstValueFrom(this.http.get<Conversation[]>(
      `${environment.domainUrl}/api/chat/conversations`
    ));
    const result = convs || [];
    this.conversations$.next(result);
    this.customerInfoCache.clear();
    for (const conv of result) {
      if (conv.conversationCode || conv.contactNumber) {
        this.customerInfoCache.set(conv.conversationId, {
          conversationCode: conv.conversationCode,
          contactNumber: conv.contactNumber,
          senderName: conv.senderName,
        });
      }
    }
    return result;
  }

  async loadMessages(conversationId: string): Promise<ChatMessage[]> {
    this.activeConversationId = conversationId;
    this.conversationUnsub?.();

    if (!this.chatDb) {
      const msgs = await firstValueFrom(this.http.get<ChatMessage[]>(
        `${environment.domainUrl}/api/chat/messages/${conversationId}`
      ));
      const result = msgs || [];
      this.activeMessages$.next(result);
      return result;
    }

    const messagesRef = collection(this.chatDb, 'chatMessages');
    const q = query(
      messagesRef,
      where('conversationId', '==', conversationId),
      orderBy('timestamp', 'asc')
    );

    return new Promise<ChatMessage[]>((resolve) => {
      let resolved = false;
      this.conversationUnsub = onSnapshot(q, (snapshot) => {
        const msgs: ChatMessage[] = snapshot.docs.map(doc =>
          this.docToMessage(doc.id, doc.data())
        );
        this.activeMessages$.next(msgs);
        snapshot.docs.forEach(doc => this.knownMessageIds.add(doc.id));

        if (!resolved) {
          resolved = true;
          resolve(msgs);
        }
      });
    });
  }

  clearActiveConversation(): void {
    this.activeConversationId = null;
    this.conversationUnsub?.();
    this.conversationUnsub = null;
    this.activeMessages$.next([]);
  }

  async sendMessage(conversationId: string, message: string): Promise<ChatMessage> {
    const body = {
      senderId: 'staff',
      senderName: 'Song Minh',
      senderType: 'staff',
      message,
      conversationId
    };
    const res = await firstValueFrom(this.http.post<{ status: string; message: ChatMessage }>(
      `${environment.domainUrl}/api/chat/send`, body
    ));
    return res.message;
  }

  clearUnread(): void {
    this.unreadTotal$.next(0);
  }

  ngOnDestroy(): void {
    this.disconnect();
    this.newMessage$.complete();
    this.conversations$.complete();
    this.activeMessages$.complete();
    this.unreadTotal$.complete();
  }

  private initFirestore(): void {
    if (this.chatDb) return;
    const config = (environment as any).firebaseChat;
    if (!config?.projectId) {
      console.warn('[ChatService] firebaseChat config not found, Firestore realtime disabled');
      return;
    }

    const appName = 'chat-realtime';
    const existing = getApps().find(app => app.name === appName);
    this.chatApp = existing || initializeApp(config, appName);
    this.chatDb = getFirestore(this.chatApp);
  }

  private docToMessage(id: string, data: any): ChatMessage {
    return {
      id,
      senderId: data['senderId'] || '',
      senderName: data['senderName'] || '',
      senderType: data['senderType'] || 'customer',
      message: data['message'] || '',
      conversationId: data['conversationId'] || '',
      timestamp: data['timestamp'] || ''
    };
  }

  private buildConversationsFromMessages(msgs: ChatMessage[]): void {
    const convMap = new Map<string, Conversation>();
    for (const msg of msgs) {
      if (!convMap.has(msg.conversationId)) {
        const cached = this.customerInfoCache.get(msg.conversationId);
        convMap.set(msg.conversationId, {
          conversationId: msg.conversationId,
          senderName: cached?.senderName || msg.senderName || msg.senderId,
          conversationCode: cached?.conversationCode,
          contactNumber: cached?.contactNumber,
          lastMessage: msg.message,
          lastTimestamp: msg.timestamp,
          senderType: msg.senderType,
        });
      }
    }
    this.conversations$.next(Array.from(convMap.values()));
  }

  private updateConversationFromMessage(msg: ChatMessage): void {
    const convs = [...this.conversations$.value];
    const idx = convs.findIndex(c => c.conversationId === msg.conversationId);
    if (idx >= 0) {
      convs[idx] = {
        ...convs[idx],
        lastMessage: msg.message,
        lastTimestamp: msg.timestamp,
        senderType: msg.senderType,
      };
      const [updated] = convs.splice(idx, 1);
      convs.unshift(updated);
    } else {
      const cached = this.customerInfoCache.get(msg.conversationId);
      convs.unshift({
        conversationId: msg.conversationId,
        senderName: cached?.senderName || msg.senderName || msg.senderId,
        conversationCode: cached?.conversationCode,
        contactNumber: cached?.contactNumber,
        lastMessage: msg.message,
        lastTimestamp: msg.timestamp,
        senderType: msg.senderType,
      });
    }
    this.conversations$.next(convs);

    if (msg.senderType === 'customer') {
      this.unreadTotal$.next(this.unreadTotal$.value + 1);
    }
  }
}
