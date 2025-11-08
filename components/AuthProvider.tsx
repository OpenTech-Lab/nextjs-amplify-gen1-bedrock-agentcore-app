"use client";

import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import "../lib/amplify";

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-background">
      <Authenticator>{children}</Authenticator>
    </div>
  );
}
