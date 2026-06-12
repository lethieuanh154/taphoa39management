import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ChatService, ChatMessage, Conversation } from '../../services/chat.service';

@Component({
  selector: 'app-chat-bubble',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Floating Chat Bubble -->
    <button class="chat-fab" (click)="togglePanel()">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
      </svg>
      <span class="unread-badge" *ngIf="unreadCount > 0">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
    </button>

    <!-- Chat Panel -->
    <div class="chat-panel" *ngIf="isPanelOpen">
      <!-- Conversation List View -->
      <ng-container *ngIf="!activeConversation">
        <div class="panel-header">
          <span>Tin nhắn khách hàng</span>
          <button class="close-btn" (click)="togglePanel()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="conv-list">
          <div class="conv-empty" *ngIf="conversations.length === 0">Chưa có tin nhắn</div>
          <div class="conv-item" *ngFor="let conv of conversations" (click)="openConversation(conv)">
            <div class="conv-avatar">{{ getInitial(conv.senderName) }}</div>
            <div class="conv-info">
              <div class="conv-name">{{ conv.senderName }} {{ conv.conversationCode ? '- ' + conv.conversationCode : '' }}{{ conv.contactNumber ? ' - ' + conv.contactNumber : ''}}</div>
              <div class="conv-last">{{ conv.lastMessage }}</div>
            </div>
            <div class="conv-time">{{ formatTime(conv.lastTimestamp) }}</div>
          </div>
        </div>
      </ng-container>

      <!-- Chat View -->
      <ng-container *ngIf="activeConversation">
        <div class="panel-header">
          <button class="back-btn" (click)="closeConversation()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <span>{{ activeConversation.senderName }} {{ activeConversation.conversationCode ?'- ' + activeConversation.conversationCode  : '' }} {{ activeConversation.contactNumber ? '- ' + activeConversation.contactNumber : ''}}</span>
          <button class="close-btn" (click)="togglePanel()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="chat-messages">
          <div *ngFor="let msg of messages" class="chat-msg"
               [class.msg-staff]="msg.senderType === 'staff'"
               [class.msg-customer]="msg.senderType === 'customer'">
            <div class="msg-bubble">{{ msg.message }}</div>
            <div class="msg-time">{{ formatTime(msg.timestamp) }}</div>
          </div>
          <div *ngIf="messages.length === 0" class="chat-empty">Chưa có tin nhắn</div>
        </div>

        <div class="chat-input">
          <input [(ngModel)]="replyText" placeholder="Trả lời..." (keydown.enter)="sendReply()" [disabled]="isSending" />
          <button class="send-btn" (click)="sendReply()" [disabled]="!replyText.trim() || isSending">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
      </ng-container>
    </div>
  `,
  styles: [`
    :host {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9000;
    }

    .chat-fab {
      width: 52px; height: 52px;
      border-radius: 50%;
      background: #43a047;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 3px 12px rgba(67,160,71,0.4);
      position: relative;
      transition: transform 0.2s;
    }
    .chat-fab:hover { transform: scale(1.08); }

    .unread-badge {
      position: absolute;
      top: -4px; right: -4px;
      background: #d32f2f;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      min-width: 20px; height: 20px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 4px;
    }

    .chat-panel {
      position: absolute;
      bottom: 62px; right: 0;
      width: 360px;
      max-height: 500px;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .panel-header {
      background: #43a047;
      color: #fff;
      padding: 12px 14px;
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .panel-header span { flex: 1; }

    .close-btn, .back-btn {
      background: none;
      border: none;
      color: #fff;
      cursor: pointer;
      padding: 2px;
      display: flex;
      align-items: center;
    }

    .conv-list {
      flex: 1;
      overflow-y: auto;
      max-height: 400px;
    }
    .conv-empty {
      text-align: center;
      color: #999;
      padding: 40px 0;
      font-size: 13px;
    }
    .conv-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      cursor: pointer;
      border-bottom: 1px solid #f0f0f0;
      transition: background 0.15s;
    }
    .conv-item:hover { background: #f5f5f5; }

    .conv-avatar {
      width: 38px; height: 38px;
      border-radius: 50%;
      background: #e8f5e9;
      color: #43a047;
      font-weight: 700;
      font-size: 15px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .conv-info { flex: 1; min-width: 0; }
    .conv-name { font-weight: 600; font-size: 13px; color: #1a1a1a; }
    .conv-last {
      font-size: 12px;
      color: #888;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .conv-time { font-size: 11px; color: #aaa; flex-shrink: 0; }

    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      min-height: 200px;
      max-height: 340px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: #f5f5f5;
    }
    .chat-msg { display: flex; flex-direction: column; max-width: 80%; }
    .msg-staff { align-self: flex-end; align-items: flex-end; }
    .msg-customer { align-self: flex-start; align-items: flex-start; }

    .msg-bubble {
      padding: 8px 14px;
      border-radius: 16px;
      font-size: 13px;
      line-height: 1.4;
      word-break: break-word;
    }
    .msg-staff .msg-bubble {
      background: #43a047;
      color: #fff;
      border-bottom-right-radius: 4px;
    }
    .msg-customer .msg-bubble {
      background: #fff;
      color: #1a1a1a;
      border: 1px solid #e0e0e0;
      border-bottom-left-radius: 4px;
    }
    .msg-time { font-size: 10px; color: #999; margin-top: 2px; padding: 0 4px; }
    .chat-empty { text-align: center; color: #999; font-size: 13px; padding: 40px 0; }

    .chat-input {
      display: flex;
      padding: 10px 12px;
      border-top: 1px solid #e0e0e0;
      gap: 8px;
      background: #fff;
    }
    .chat-input input {
      flex: 1;
      border: 1px solid #e0e0e0;
      border-radius: 20px;
      padding: 8px 14px;
      font-size: 13px;
      outline: none;
    }
    .chat-input input:focus { border-color: #43a047; }

    .send-btn {
      width: 36px; height: 36px;
      border-radius: 50%;
      background: #43a047;
      color: #fff;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .send-btn:disabled { background: #b0bec5; cursor: not-allowed; }

    @media (max-width: 420px) {
      .chat-panel { width: calc(100vw - 32px); right: -4px; }
    }
  `]
})
export class ChatBubbleComponent implements OnInit, OnDestroy {
  isPanelOpen = false;
  conversations: Conversation[] = [];
  activeConversation: Conversation | null = null;
  messages: ChatMessage[] = [];
  replyText = '';
  isSending = false;
  unreadCount = 0;

  private subs: Subscription[] = [];

  constructor(private chatService: ChatService, private cdr: ChangeDetectorRef) { }

  ngOnInit(): void {
    this.chatService.connect();

    this.subs.push(
      this.chatService.getConversations$().subscribe(convs => {
        this.conversations = convs;
        this.cdr.markForCheck();
      }),
      this.chatService.getActiveMessages$().subscribe(msgs => {
        this.messages = msgs;
        this.cdr.markForCheck();
        setTimeout(() => this.scrollToBottom(), 50);
      }),
      this.chatService.getUnreadTotal$().subscribe(count => {
        this.unreadCount = count;
        this.cdr.markForCheck();
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  togglePanel(): void {
    this.isPanelOpen = !this.isPanelOpen;
    if (this.isPanelOpen) {
      this.activeConversation = null;
      this.chatService.clearActiveConversation();
      this.chatService.clearUnread();
      this.chatService.loadConversations();
    }
    this.cdr.markForCheck();
  }

  openConversation(conv: Conversation): void {
    this.activeConversation = conv;
    this.cdr.markForCheck();
    this.chatService.loadMessages(conv.conversationId);
  }

  closeConversation(): void {
    this.activeConversation = null;
    this.chatService.clearActiveConversation();
    this.cdr.markForCheck();
    this.chatService.loadConversations();
  }

  async sendReply(): Promise<void> {
    const text = this.replyText.trim();
    if (!text || this.isSending || !this.activeConversation) return;

    this.isSending = true;
    this.cdr.markForCheck();

    try {
      await this.chatService.sendMessage(this.activeConversation.conversationId, text);
      this.replyText = '';
    } catch (err) {
      console.error('[Chat] Send failed:', err);
    }

    this.isSending = false;
    this.cdr.markForCheck();
  }

  getInitial(name: string): string {
    if (!name) return '?';
    return name.charAt(0).toUpperCase();
  }

  formatTime(timestamp: string): string {
    if (!timestamp) return '';
    const d = new Date(timestamp.endsWith('Z') ? timestamp : timestamp + 'Z');
    const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    if (d.getFullYear() === new Date().getFullYear()) return `${day}/${month} ${time}`;
    return `${day}/${month}/${d.getFullYear()} ${time}`;
  }

  private scrollToBottom(): void {
    const el = document.querySelector('.chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }
}
