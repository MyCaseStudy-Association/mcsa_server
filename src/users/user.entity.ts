export interface User {
  id: string;
  role: 'user' | 'buyer' | 'admin';
  name: string | null;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWithPassword extends User {
  passwordHash: string;
}
