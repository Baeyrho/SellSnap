import { prisma } from '../lib/prisma'
import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'

async function main() {
  // This seed deletes every order, product, reset token and user. Refuse to run in production
  // unless the operator explicitly opts in.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DESTRUCTIVE_SEED !== '1') {
    throw new Error(
      'Refusing to run the destructive seed in production. Set ALLOW_DESTRUCTIVE_SEED=1 to override.'
    )
  }

  console.log('Seeding database...')

  // Clean existing data
  await prisma.order.deleteMany()
  await prisma.product.deleteMany()
  await prisma.passwordResetToken.deleteMany()
  await prisma.user.deleteMany()

  // Create test users
  const passwordHash = await bcrypt.hash('TestPass1', 12)

  const seller1 = await prisma.user.create({
    data: {
      email: 'seller@test.com',
      passwordHash,
      name: 'Test Seller',
      bankCode: '058',
      accountNumber: '1234567890',
      flutterwaveSubaccountId: 'FLW_SUB_TEST_001',
    },
  })

  const seller2 = await prisma.user.create({
    data: {
      email: 'store@test.com',
      passwordHash,
      name: 'Another Store',
      bankCode: '044',
      accountNumber: '9876543210',
      flutterwaveSubaccountId: 'FLW_SUB_TEST_002',
    },
  })

  // Create test products
  const products = await Promise.all([
    prisma.product.create({
      data: {
        sellerId: seller1.id,
        slug: nanoid(10),
        name: 'Premium Sneakers',
        description: 'High-quality sneakers for everyday wear.',
        priceKobo: 2500000,
        imageUrl: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400',
        imageUrls: [
          'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400',
          'https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=400',
          'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=400',
        ],
      },
    }),
    prisma.product.create({
      data: {
        sellerId: seller1.id,
        slug: nanoid(10),
        name: 'Leather Backpack',
        priceKobo: 1500000,
        imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400',
        imageUrls: [
          'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400',
          'https://images.unsplash.com/photo-1622560480605-d83c853bc5c3?w=400',
        ],
      },
    }),
    prisma.product.create({
      data: {
        sellerId: seller2.id,
        slug: nanoid(10),
        name: 'Wireless Headphones',
        description: 'Noise-cancelling wireless headphones with 30hr battery.',
        priceKobo: 3500000,
        imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400',
        imageUrls: [
          'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400',
        ],
      },
    }),
  ])

  // Create test orders
  await Promise.all([
    prisma.order.create({
      data: {
        productId: products[0].id,
        sellerId: seller1.id,
        amountKobo: 2500000,
        status: 'SUCCESS',
        customerName: 'John Buyer',
        customerEmail: 'john@example.com',
        transactionRef: 'SS-TEST001',
        flutterwaveTxId: 12345,
      },
    }),
    prisma.order.create({
      data: {
        productId: products[1].id,
        sellerId: seller1.id,
        amountKobo: 1500000,
        status: 'PENDING',
        customerName: 'Jane Buyer',
        customerEmail: 'jane@example.com',
        transactionRef: 'SS-TEST002',
      },
    }),
    prisma.order.create({
      data: {
        productId: products[2].id,
        sellerId: seller2.id,
        amountKobo: 3500000,
        status: 'SUCCESS',
        customerEmail: 'buyer@example.com',
        transactionRef: 'SS-TEST003',
        flutterwaveTxId: 12346,
      },
    }),
  ])

  console.log('Seeding complete!')
  console.log('Test accounts:')
  console.log('  Email: seller@test.com / Password: TestPass1')
  console.log('  Email: store@test.com / Password: TestPass1')
}

main()
  .catch((e) => {
    console.error('Seed error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
