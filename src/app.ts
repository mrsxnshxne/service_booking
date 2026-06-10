import express from "express"
import { errorHandler } from "./middleware/error"
import { availabilityRouter, holdSlotsRouter } from "./routes/availability"
import { bookingsRouter } from "./routes/bookings"

const app = express()

app.use(express.json())

// Same paths as the gateway: the gateway forwards req.originalUrl untouched.
const v1 = express.Router()

v1.use("/properties/:property_id/availability", availabilityRouter)
v1.use("/properties/:property_id/hold-slots", holdSlotsRouter)
v1.use("/bookings", bookingsRouter)

app.use("/api/v1", v1)

app.use(errorHandler)

export default app
