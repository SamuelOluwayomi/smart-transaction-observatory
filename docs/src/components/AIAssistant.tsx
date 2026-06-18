import React, { useState, useRef, useEffect } from 'react';
import { Brain } from './phosphor-icons';

export default function AIAssistant() {
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([
    {
      role: "assistant",
      content: "Hi! I am Sentry AI, your systems operator assistant. Ask me anything about setting up, configuring, running, or auditing the Sentry Smart Transaction Stack!",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;

    const userMessage = { role: "user", content: chatInput };
    const newMessages = [...chatMessages, userMessage];
    setChatMessages(newMessages);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch("http://localhost:3000/api/docs/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok) throw new Error("Failed to contact Sentry AI");
      const data = await res.json();

      setChatMessages([...newMessages, { role: "assistant", content: data.content }]);
    } catch (err) {
      console.error("Docs Chat error:", err);
      setChatMessages([
        ...newMessages,
        {
          role: "assistant",
          content: "Error: I could not contact the local server. Make sure the Next.js Dashboard is running on port 3000 and your GROQ_API_KEY is configured in the environment.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div style={{
      border: '1px solid var(--ifm-color-emphasis-300)',
      borderRadius: 'var(--ifm-global-radius)',
      overflow: 'hidden',
      marginTop: '2rem',
      backgroundColor: 'var(--ifm-background-surface-color)'
    }}>
      <div style={{
        padding: '1rem',
        borderBottom: '1px solid var(--ifm-color-emphasis-300)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        backgroundColor: 'var(--ifm-color-emphasis-100)'
      }}>
        <Brain size={24} weight="bold" />
        <strong style={{ textTransform: 'uppercase', fontSize: '0.9rem' }}>Sentry AI Chat</strong>
      </div>
      
      <div style={{
        height: '350px',
        overflowY: 'auto',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        {chatMessages.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              backgroundColor: msg.role === "user" ? "var(--ifm-color-primary)" : "var(--ifm-color-emphasis-200)",
              color: msg.role === "user" ? "#fff" : "inherit",
              padding: '0.75rem 1rem',
              borderRadius: '0.5rem',
              maxWidth: '85%',
              fontSize: '0.9rem',
              lineHeight: '1.5'
            }}
          >
            {msg.content}
          </div>
        ))}
        {chatLoading && (
          <div style={{
            alignSelf: "flex-start",
            backgroundColor: "var(--ifm-color-emphasis-200)",
            padding: '0.75rem 1rem',
            borderRadius: '0.5rem',
            fontSize: '0.9rem'
          }}>
            <em>Thinking...</em>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <form onSubmit={handleSendChat} style={{
        display: 'flex',
        borderTop: '1px solid var(--ifm-color-emphasis-300)',
        padding: '0.5rem',
        backgroundColor: 'var(--ifm-background-color)'
      }}>
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          placeholder="Ask a question about the protocol..."
          disabled={chatLoading}
          style={{
            flex: 1,
            padding: '0.5rem 1rem',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'var(--ifm-font-color-base)'
          }}
        />
        <button
          type="submit"
          disabled={chatLoading}
          style={{
            padding: '0.5rem 1.5rem',
            backgroundColor: 'var(--ifm-color-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--ifm-global-radius)',
            cursor: chatLoading ? 'not-allowed' : 'pointer',
            fontWeight: 'bold'
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
